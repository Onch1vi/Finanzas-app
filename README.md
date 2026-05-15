# Finanzas App

Single-page PWA para finanzas personales: deudas, ingresos, egresos, planes y proyección — con simulación día-a-día del mes actual y fechas exactas para metas.

## Cambios recientes (lógica de fechas y balance real)

1. **Balance real "hoy"** — un campo nuevo en ajustes guarda tu efectivo disponible ahora. La app simula día a día tu plata desde hoy hasta fin de mes considerando lo confirmado y lo pendiente.
2. **Cuándo entras en negativo y cuándo recuperas** — la tarjeta "Tu plata hoy" te dice la fecha exacta en que entrarías en rojo y cuándo vuelves a positivo.
3. **Deudas con fecha futura de inicio** — al crear una deuda puedes indicar la fecha en que empieza la primera cuota (ej. julio). Hasta entonces no descuenta nada de tu flujo ni la marca como vencida.
4. **Plan de pagos visible** — al crear una deuda, la app muestra cuántas cuotas tomará y la fecha exacta en que quedarás libre.
5. **Fechas clave en el dashboard** — ahora ves la fecha exacta en que: alcanzarás tu meta de ahorro, quedarás libre de deudas, y volverás a estar estable si estás corto este mes.

## Despliegue

### Vercel
```bash
# Si tienes Vercel CLI
vercel --prod
```
O importa el repo en [vercel.com/new](https://vercel.com/new). El `vercel.json` ya está configurado.

### Netlify
Drag-and-drop el repo en netlify.com, o conecta el repo de GitHub. `netlify.toml` ya está configurado.

### GitHub Pages
```bash
# Activa Pages en Settings → Pages, branch: main, folder: /
```

## Desarrollo local

Es un único `index.html` que carga React 18 + Babel Standalone desde CDN. No necesita build.

```bash
# Servidor simple
python3 -m http.server 8000
# luego abre http://localhost:8000
```

## Estructura

- `index.html` — toda la app (React + estilos inline)
- `vercel.json`, `netlify.toml` — configuración de hosting
- `.gitignore` — ignora artefactos

Los datos se guardan en `localStorage` del navegador. Para respaldo, usa **Ajustes → Exportar datos**.

## Modelo de datos relevante

```js
{
  user: { name, currency, themeOverride },
  savings: {
    currentBalance,        // efectivo hoy (NUEVO)
    balanceUpdatedAt,      // ISO date
    current,               // ahorros formales
    goal, goalDate,
    emergencyMonths, lifeBudgetPct, bufferPct, minLifeBudget
  },
  debts: [{ id, name, totalAmount, paidAmount, minimumPayment,
            paymentDay, interestRate,
            startDate,    // NUEVO: cuándo empieza la primera cuota
            archived, notes }],
  incomes: [...], expenses: [...], plans: [...],
  confirmations: { 'YYYY-MM': { 'inc-id': {...}, 'exp-id': {...} } },
  transactions: [...],
  settings: { hideAmounts, notificationsEnabled }
}
```
