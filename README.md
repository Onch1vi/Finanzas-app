# Finanzas App

Single-page PWA para finanzas personales: deudas, ingresos, egresos, planes y proyección — con simulación día-a-día del mes actual y fechas exactas para metas.

## Sync entre dispositivos (Supabase)

La app puede sincronizar tus datos entre PC y celular con login privado. **Solo tú ves tus datos** gracias a Row Level Security.

👉 Guía paso a paso en [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) (~5 minutos)

Mientras no configures Supabase, la app funciona en modo local (solo guarda en este dispositivo).

## Cambios recientes

### Sync entre dispositivos (nuevo)
- Login con email/contraseña.
- Tus datos viven en una fila privada de Supabase con RLS — nadie más puede leerlos.
- Sync automático al cambiar algo, debounced 1.2s.
- Si te logueas por primera vez con datos locales, se suben a la nube automáticamente.
- Estado de sync visible en Ajustes ("Sincronizando…" / "Sincronizado").

### Tema "Studio" (nuevo)
- Paleta crema/púrpura con tipografía serif (Fraunces) y acento manuscrito (Caveat).
- Inspirado en interfaces tipo "journal" (papel + acentos pintados a mano).
- Activable en **Ajustes → Tema → Studio**.
- Los temas oscuros existentes siguen disponibles.

### Lógica de fechas y balance real
1. **Balance real "hoy"** — `savings.currentBalance` guarda tu efectivo disponible. La app simula día a día desde hoy hasta fin de mes considerando lo confirmado y lo pendiente.
2. **Cuándo entras en negativo y cuándo recuperas** — fechas exactas en la tarjeta "Tu plata hoy".
3. **Deudas con fecha futura de inicio** — `debt.startDate` permite registrar una deuda cuya primera cuota es en el futuro (ej. julio). Hasta entonces no descuenta nada de tu flujo.
4. **Plan de pagos visible** — al crear una deuda, ves cuántas cuotas tomará y la fecha exacta de la última.
5. **Fechas clave en el dashboard** — fecha exacta para: meta de ahorro, libre de deudas, estabilidad recuperada.

## Despliegue

### Vercel
1. Importa el repo en https://vercel.com/new (no necesita build, ya está configurado por `vercel.json`).
2. Después de la primera URL, sigue [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) si quieres sync.

### Netlify
Drag-and-drop el repo en netlify.com o conecta el repo. `netlify.toml` ya está configurado.

### GitHub Pages
Settings → Pages → Branch `main`, folder `/`.

## Desarrollo local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

- `index.html` — toda la app (React + estilos inline + Babel standalone)
- `vercel.json`, `netlify.toml` — config de hosting
- `SUPABASE_SETUP.md` — guía de sync en la nube
- `.gitignore`

## Modelo de datos

```js
{
  user: { name, currency, themeOverride },  // themeOverride incluye 'studio'
  savings: {
    currentBalance,        // efectivo hoy (alimenta el balance real)
    balanceUpdatedAt,
    current,               // ahorros formales
    goal, goalDate,
    emergencyMonths, lifeBudgetPct, bufferPct, minLifeBudget
  },
  debts: [{ id, name, totalAmount, paidAmount, minimumPayment,
            paymentDay, interestRate,
            startDate,    // cuándo empieza la primera cuota (futuro permitido)
            archived, notes }],
  incomes: [...], expenses: [...], plans: [...],
  confirmations: { 'YYYY-MM': { 'inc-id': {...}, 'exp-id': {...} } },
  transactions: [...],
  settings: { hideAmounts, notificationsEnabled }
}
```

Cuando Supabase está configurado y has iniciado sesión, este JSON se guarda en la fila `user_data` de tu cuenta.

