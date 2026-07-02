import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.URL || 'http://localhost:4173';

const seed = {
  user: { name: 'Sebastián', currency: 'COP', themeOverride: 'studio' },
  savings: { current: 0, goal: 0, goalDate: '', emergencyMonths: 3, lifeBudgetPct: 0.15, bufferPct: 0.10, minLifeBudget: 0, currentBalance: 1000000, balanceUpdatedAt: '', monthlyContribution: 2000000 },
  debts: [
    { id: 'd1', name: 'Mamá', totalAmount: 600000, paidAmount: 0, minimumPayment: 600000, interestRate: 0, paymentDay: 30, startDate: '', archived: false, notes: 'termino de pagar' },
    { id: 'd2', name: 'Tarjeta de crédito', totalAmount: 991225, paidAmount: 0, minimumPayment: 991225, interestRate: 0, paymentDay: 15, startDate: '', archived: false, notes: 'Avianca 6 cuotas' },
  ],
  incomes: [{ id: 'i1', name: 'Nómina + prima', amount: 4841812, active: true, frequency: 'monthly', dayOfMonth: 30 }],
  expenses: [
    { id: 'e1', name: 'Arriendo 1', amount: 730000, active: true, frequency: 'monthly', category: 'housing', dayOfMonth: 5, notes: 'mensual fijo' },
    { id: 'e2', name: 'Internet', amount: 109000, active: true, frequency: 'monthly', category: 'utilities', dayOfMonth: 5, notes: 'mensual fijo' },
    { id: 'e3', name: 'Mercado', amount: 800000, active: true, frequency: 'monthly', category: 'food', dayOfMonth: 15, notes: 'mensual variable' },
  ],
  plans: [], transactions: [], budgets: {}, confirmations: {}, netWorthHistory: [],
  settings: { hideAmounts: false, notificationsEnabled: false }, userNotes: 'Este mes no pedir más préstamos',
};

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch({ executablePath: CHROME });
for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript((s) => { localStorage.setItem('finanzas-app-v1', JSON.stringify(s)); }, seed);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `tests/shot-${vp.name}-home.png`, fullPage: true });
  // Deudas
  await page.getByText('Deudas', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `tests/shot-${vp.name}-debts.png` });
  // Open new-debt sheet
  const fab = page.locator('.fab').first();
  await fab.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tests/shot-${vp.name}-sheet.png` });
  console.log(`${vp.name}: ok`);
  await ctx.close();
}
await browser.close();
console.log('done');
