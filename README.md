# Finanzas App

PWA personal de finanzas: deudas con fecha futura, balance real día a día, asesor con plan paso-a-paso, sync entre dispositivos, presupuestos por categoría, net worth histórico, 2FA, y notificaciones nativas.

Stack: **React 18 + Vite + Supabase** · Hosting: **Vercel** (o Netlify).

---

## Setup local

```bash
npm install
npm run dev    # arranca Vite en http://localhost:5173
```

Para usar la sync en local, crea `.env.local`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

Sin estas variables la app funciona en modo offline-only (localStorage).

---

## Build de producción

```bash
npm run build       # output en dist/
npm run preview     # sirve dist/ para probar
```

---

## Despliegue en Vercel

1. Importa el repo en https://vercel.com/new.
2. **Settings → Environment Variables** → añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)).
3. Cada push a `main` deploya automáticamente. El `vercel.json` ya está configurado para `npm run build` con output en `dist/`.

## Despliegue en Netlify

Igual, `netlify.toml` configurado. Variables en **Site configuration → Environment variables**.

---

## Estructura del proyecto

```
finanzas-app/
├── index.html                # entry de Vite (~50 líneas, minimal)
├── src/
│   ├── main.jsx              # punto de entrada, registra SW
│   ├── App.jsx               # toda la app React (~7000 líneas, intencional)
│   └── styles.css            # CSS global con variables de tema
├── public/
│   ├── manifest.webmanifest  # PWA manifest
│   └── sw.js                 # service worker
├── package.json
├── vite.config.js
├── vercel.json
├── netlify.toml
├── SUPABASE_SETUP.md         # setup de sync
├── MFA_SETUP.md              # setup de 2FA
└── SECURITY_AUDIT.md         # audit de seguridad
```

---

## Funcionalidades principales

- **Deudas con fecha futura**: registra deudas cuya primera cuota es en el futuro (ej. julio).
- **Balance real "hoy"**: simulación día a día del mes con fechas exactas en que entras/sales de negativo.
- **Asesor financiero**: plan numerado con montos específicos, fechas y "fugas" detectadas.
- **Sync con conflict resolution**: nunca pisa cambios de tu otro dispositivo sin preguntar.
- **Presupuestos por categoría**: tope mensual con progreso visual.
- **Net worth histórico**: gráfica de patrimonio neto mes a mes.
- **2FA opcional**: TOTP vía Google/Microsoft Authenticator.
- **Notifs nativas vía SW**: funcionan en iOS PWA (16.4+) y persisten en Android.
- **CSV / JSON export + import**: para contador, declaración o backup.
- **Tema "Studio" claro**: paleta crema + serif elegante, además de los 7 oscuros.

---

## Modelo de datos (en Supabase: una fila por usuario en `user_data.data`)

```js
{
  user: { name, currency, themeOverride },
  savings: { currentBalance, current, goal, goalDate, emergencyMonths,
             lifeBudgetPct, bufferPct, minLifeBudget, balanceUpdatedAt },
  debts: [{ id, name, totalAmount, paidAmount, minimumPayment,
            paymentDay, interestRate, startDate, archived, notes }],
  incomes: [{ id, name, amount, frequency, dayOfMonth, anchorDate, ... }],
  expenses: [{ id, name, amount, frequency, dayOfMonth, anchorDate, ... }],
  plans: [...],
  transactions: [...],
  budgets: { [categoryId]: monthlyLimit },
  confirmations: { 'YYYY-MM': { [`exp-id-...`]: {...} } },
  netWorthHistory: [{ monthKey, date, cash, savings, debts, netWorth }],
  settings: { hideAmounts, notificationsEnabled, lastBackupAt },
}
```
