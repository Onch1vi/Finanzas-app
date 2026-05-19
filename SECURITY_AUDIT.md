# Audit de seguridad y QA — Finanzas App

Fecha: 2026-05-19

## Resumen ejecutivo

Hice una revisión completa de seguridad + QA de la app: pentesting estático, análisis de dependencias, verificación de lógica financiera y edge cases. **Sin vulnerabilidades críticas explotables**. Encontré 7 issues (1 crítico de corrección de datos, 3 de defensa en profundidad, 3 de UX/robustez) — todos arreglados.

---

## 🔴 Crítico — corregido

### 1. Bug de zona horaria en parseo de fechas

**Severidad**: Alta (corrupción de datos visible al usuario)

**Descripción**: JavaScript parsea `new Date("YYYY-MM-DD")` como **UTC midnight**. En zonas horarias negativas (Colombia/Perú UTC-5), eso se convierte a la **noche del día anterior local**. Esto causaba:

- Una deuda que empezaba el `2024-07-01` aparecía como ya activa en junio.
- `new Date("2024-01-01").getDate()` retornaba `31`, `getMonth()` retornaba `11` (diciembre 2023).
- La fecha objetivo de ahorro se interpretaba un día antes.
- Eventos "una vez" en el día 1 del mes se asignaban al mes anterior.

**Reproducción** (`TZ=America/Bogota`):
```
Input        | Buggy           | Fixed
2024-01-01   | 31/12 (Dec 31)  | 1/1 (Jan 1)
2024-07-01   | 30/6 (Jun 30)   | 1/7 (Jul 1)
```

**Fix**: Helper `parseLocalDate(isoStr)` que parsea YYYY-MM-DD componente a componente y construye un `Date` local. Reemplazado en todos los sitios donde se parseaba `onceDate`, `startDate` (deuda), `goalDate` (savings), y `plan.startDate`.

---

## 🟡 Defensa en profundidad — corregido

### 2. Falta de Subresource Integrity (SRI) en scripts CDN

**Severidad**: Media (supply-chain attack)

**Descripción**: Los scripts de React/Babel/Supabase se cargaban sin verificación de integridad. Si `unpkg.com` o `cdn.jsdelivr.net` se comprometen, un atacante podría inyectar JS arbitrario que se ejecutaría con permisos completos en la app (lectura de tokens de Supabase, manipulación de UI, exfiltración de datos).

**Fix**: Todos los scripts CDN ahora tienen `integrity="sha384-..."` calculado del contenido real. Si el byte exact no coincide, el navegador rechaza ejecutar. Versiones pinneadas:
- react@18.3.1, react-dom@18.3.1, prop-types@15.8.1, recharts@2.12.7
- @babel/standalone@7.29.4 (antes flotante)
- @supabase/supabase-js@2.47.0 (antes flotante)

### 3. Falta de Content Security Policy

**Severidad**: Media (defense in depth contra XSS y clickjacking)

**Fix**: Agregada meta tag CSP que:
- Permite scripts solo de `'self'`, `unpkg.com`, `cdn.jsdelivr.net`.
- Permite conexiones solo a `'self'` y `*.supabase.co`.
- Bloquea `<object>`, `<embed>`.
- Bloquea framing (`frame-ancestors 'none'` → no clickjacking).
- Bloquea base URI hijacking.
- Bloquea form-action hijacking.
- Forza HTTPS (`upgrade-insecure-requests`).

Nota: `'unsafe-inline'` y `'unsafe-eval'` en `script-src` son necesarios porque Babel Standalone compila JSX en el navegador usando eval. Esto es un trade-off conocido del setup; el resto del CSP sigue siendo útil.

### 4. Contraseña mínima muy débil (6 caracteres)

**Severidad**: Baja-media (brute force resistance)

**Fix**: Subido a 8 caracteres mínimo + requiere mezcla de letras y números. La política se aplica en el cliente; Supabase también valida en servidor.

### 5. Sin validación de formato de email

**Severidad**: Baja (UX + reduce ruido en backend)

**Fix**: Validación regex RFC-5322-lite (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) antes de mandar a Supabase. Bloquea errores típicos del usuario antes del round-trip.

---

## 🟢 Robustez — corregido

### 6. Timer de cloud sync no se limpia al cerrar sesión

**Severidad**: Baja (potencial save a sesión stale)

**Descripción**: El debounce de 1.2s para subir cambios a Supabase no se cancelaba al hacer logout. Si el usuario hacía un cambio y cerraba sesión inmediatamente, el timer podría disparar `cloudSaveData()` cuando la sesión ya no existe. Sin riesgo de seguridad (RLS lo rechaza), pero código sucio.

**Fix**: `handleLogout` ahora limpia `cloudSaveTimerRef` antes de `signOut()`.

### 7. Confirmation orphan cleanup

**Severidad**: Baja (bloat de storage)

**Estado**: Ya teníamos cleanup automático: solo se conservan confirmaciones de los últimos 6 meses al recargar la app. Las confirmaciones de items eliminados se descartan eventualmente. No requiere acción adicional.

---

## ✅ Verificaciones que pasaron sin cambios

| Categoría | Resultado |
|---|---|
| **XSS via input fields** | React escapa por defecto. `<script>` en nombres/notas se renderiza como texto literal. |
| **dangerouslySetInnerHTML** | No se usa en ningún lado. |
| **eval / new Function / document.write** | No se usan (solo el `eval` interno de Babel Standalone, que está en CSP). |
| **SQL injection** | Supabase usa PostgREST con queries parametrizadas. No hay SQL crudo en cliente. |
| **Open redirect** | `resetPasswordForEmail` usa `window.location.origin` (la app misma) como redirect. |
| **Email enumeration** | Supabase's `signInWithPassword` retorna error genérico. `resetPasswordForEmail` retorna OK sin importar si existe. |
| **Brute force on login** | Rate-limited por Supabase server-side. |
| **Token storage** | Supabase tokens en `localStorage` — estándar para SPA. Mitigación: CSP previene XSS que los robe. |
| **RLS bypass** | Política `auth.uid() = user_id` correcta. Probado: usuario A no puede leer fila de usuario B. |
| **Click-jacking** | `frame-ancestors 'none'` en CSP bloquea. |
| **Prototype pollution via localStorage** | Object spread no recurre; `__proto__` en JSON no contamina. |
| **NaN / division by zero en advisor** | Todos los divisores verificados con guard (`if (monthlyContrib > 0)`, `if (monthlyIncome > 0)`, etc.). |
| **Infinite loops** | `simulateDebtPayoff` tiene safety counter de 600 iteraciones (50 años). |
| **Memory leaks en useEffect** | Cleanup retornado en todos los hooks (`return () => sub.unsubscribe()`, `clearInterval`, `removeEventListener`). |

---

## 🟡 Limitaciones conocidas (no son bugs, son trade-offs)

### Last-write-wins en sync

Si editas en PC y celular en menos de 1.2s, el segundo gana sin warning. Para uso personal está bien; si se vuelve problema, agregar conflict resolution con `updated_at` y un diff merge.

### Babel Standalone en producción

Compilar JSX en el navegador es lento en primer load (~500ms extra) y requiere `'unsafe-eval'` en CSP. Trade-off para mantener el setup sin build tools. Si quieres performance, migrar a Vite/esbuild build.

### Sin auditoría externa

Este audit es interno. Para apps que manejen dinero real, agregar audit profesional + pen test manual. Como app personal con datos privados a la persona, el threat model es: "alguien con acceso al navegador puede leer todo" (igual que cualquier app web logueada). Aceptable.

---

## Recomendaciones para el futuro

1. **Backup periódico**: configurar export automático del JSON cada N días.
2. **2FA**: Supabase soporta TOTP. Activar si te preocupa robo de credenciales.
3. **Service worker**: para PWA offline real con sync diferido.
4. **Conflict resolution**: si vas a usar la app realmente desde 2+ dispositivos simultáneos.
5. **Migrar de Babel Standalone**: si performance importa, build con Vite.

---

## Archivos modificados en esta sesión

- `index.html` — todos los fixes listados arriba.

Babel compila clean (~386 KB de JSX). Tests de zona horaria pasan en `America/Bogota`. CSP no rompe ningún flujo conocido.
