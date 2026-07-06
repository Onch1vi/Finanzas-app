// End-to-end flow: drives the REAL app, seeds full scenarios (debts, loans,
// plans, purchases, savings), reads rendered "Tu plata hoy", verifies logic.
import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = 'http://localhost:4173';

const base = {
  user: { name: 'Sebastián', currency: 'COP', themeOverride: 'studio' },
  savings: { currentBalance: 2200000, current: 0, emergencyMonths: 3, lifeBudgetPct: 0.15, bufferPct: 0.10, balanceUpdatedAt: '2026-07-01T08:00:00.000Z' },
  incomes: [{ id: 'nom', name: 'Nómina', amount: 3859800, active: true, frequency: 'monthly', dayOfMonth: 31 }],
  expenses: [],
  debts: [
    { id: 'd1', name: 'Tarjeta', totalAmount: 981507, paidAmount: 0, minimumPayment: 981507, interestRate: 0, paymentDay: 5, archived: false },
    { id: 'd2', name: 'Préstamo', totalAmount: 780000, paidAmount: 0, minimumPayment: 780000, interestRate: 0, paymentDay: 8, archived: false },
  ],
  plans: [], transactions: [], budgets: {}, netWorthHistory: [], settings: {}, userNotes: '',
};

async function readPlataHoy(page) {
  const txt = await page.evaluate(() => {
    const label = [...document.querySelectorAll('*')].find(n => n.textContent.trim().toUpperCase() === 'TU PLATA HOY');
    if (!label) return null;
    const card = label.closest('.card-elevated') || label.parentElement.parentElement;
    const h2 = card.querySelector('h2');
    return h2 ? h2.textContent : null;
  });
  return txt ? parseInt(txt.replace(/[^\d]/g, ''), 10) : null;
}

const browser = await chromium.launch({ executablePath: CHROME });
let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${name}: got ${got}, want ${want}`);
  if (!ok) fails++;
}
async function scenario(name, mutate, expected) {
  const data = JSON.parse(JSON.stringify(base));
  mutate(data);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript((s) => localStorage.setItem('finanzas-app-v1', JSON.stringify(s)), data);
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForTimeout(1300);
  check(name, await readPlataHoy(page), expected);
  await ctx.close();
}

await scenario('Sin pagos', () => {}, 2200000);
await scenario('Pagó Tarjeta 981.507', (d) => {
  d.debts[0].paidAmount = 981507;
  d.confirmations = { '2026-07': { 'debt-d1-2026-07': { confirmedAt: '2026-07-05T10:00:00.000Z', amount: 981507, appliedAmount: 981507, debtId: 'd1' } } };
}, 1218493);
await scenario('Pagó Tarjeta + Préstamo', (d) => {
  d.debts[0].paidAmount = 981507; d.debts[1].paidAmount = 780000;
  d.confirmations = { '2026-07': {
    'debt-d1-2026-07': { confirmedAt: '2026-07-05T10:00:00.000Z', amount: 981507, appliedAmount: 981507, debtId: 'd1' },
    'debt-d2-2026-07': { confirmedAt: '2026-07-08T10:00:00.000Z', amount: 780000, appliedAmount: 780000, debtId: 'd2' },
  } };
}, 438493);

// PLAN: purchase with own cash this month, confirmed → cash drops by cost
await scenario('Compra al contado confirmada', (d) => {
  d.debts = [];
  d.plans = [{ id: 'p1', name: 'iPhone', type: 'purchase', financing: 'own', cost: 500000, penaltyCost: 0, startDate: '2026-07-04', active: true }];
  d.confirmations = { '2026-07': { 'plan-p1-buy-2026-07': { confirmedAt: '2026-07-04T10:00:00.000Z', delta: -500000, name: 'iPhone' } } };
}, 1700000);

// PLAN: savings goal set aside this month, confirmed → cash drops (moves to savings)
await scenario('Meta de ahorro apartada', (d) => {
  d.debts = [];
  d.plans = [{ id: 'p2', name: 'Viaje', type: 'savings', cost: 300000, startDate: '2026-07-02', active: true }];
  d.confirmations = { '2026-07': { 'plan-p2-goal-2026-07': { confirmedAt: '2026-07-02T10:00:00.000Z', delta: -300000, name: 'Meta: Viaje' } } };
}, 1900000);

// PLAN: long-term loan cuota confirmed this month → cash drops by the cuota only
await scenario('Cuota de préstamo largo (compra financiada)', (d) => {
  d.debts = [];
  // 12M loan, 0% for simple math, 12 months → cuota = 1,000,000
  d.plans = [{ id: 'p3', name: 'Carro', type: 'purchase', financing: 'loan', cost: 12000000, loanMonths: 12, loanRate: 0, graceMonths: 0, startDate: '2026-07-10', active: true }];
  d.confirmations = { '2026-07': { 'plan-p3-cuota-2026-07': { confirmedAt: '2026-07-10T10:00:00.000Z', delta: -1000000, name: 'Cuota Carro' } } };
}, 1200000);

// UNCONFIRMED plan does NOT change cash today (only the forecast)
await scenario('Plan sin confirmar no toca la plata de hoy', (d) => {
  d.debts = [];
  d.plans = [{ id: 'p4', name: 'TV', type: 'purchase', financing: 'own', cost: 800000, startDate: '2026-07-20', active: true }];
  d.confirmations = {};
}, 2200000);

await browser.close();
console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails > 0 ? 1 : 0);
