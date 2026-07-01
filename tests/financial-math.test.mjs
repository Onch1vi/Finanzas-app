// Self-contained tests for the financial math.
// Re-implements the key helpers (parseLocalDate, simulateMonthDaily,
// simulateDebtPayoff, monthRealStats logic, computeCurrentNetWorth) and runs
// scenario assertions. Run with: node tests/financial-math.test.mjs

import assert from 'node:assert/strict';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
}

// ---------- helpers (mirror of src/App.jsx) ----------

const parseLocalDate = (isoStr) => {
  if (isoStr === null || isoStr === undefined || isoStr === '') return null;
  const s = String(isoStr);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(s);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
};

function isDebtFutureStart(debt, today = new Date()) {
  if (!debt.startDate) return false;
  const ds = parseLocalDate(debt.startDate);
  if (!ds || isNaN(ds)) return false;
  const dsKey = ds.getFullYear() * 12 + ds.getMonth();
  const tKey = today.getFullYear() * 12 + today.getMonth();
  return dsKey > tKey;
}

function simulateDebtPayoff(debt, startDate = new Date()) {
  const schedule = [];
  let balance = debt.totalAmount - (debt.paidAmount || 0);
  if (balance <= 0 || debt.archived) return schedule;
  const monthlyRate = (debt.interestRate || 0) / 100 / 12;
  const minPayment = debt.minimumPayment || 0;
  let firstYear = startDate.getFullYear();
  let firstMonth = startDate.getMonth();
  if (debt.startDate) {
    const ds = parseLocalDate(debt.startDate);
    if (ds && !isNaN(ds)) {
      const dsKey = ds.getFullYear() * 12 + ds.getMonth();
      const stKey = firstYear * 12 + firstMonth;
      if (dsKey > stKey) { firstYear = ds.getFullYear(); firstMonth = ds.getMonth(); }
    }
  }
  let safety = 600, m = 0;
  while (balance > 0 && safety-- > 0) {
    const interest = balance * monthlyRate;
    const payment = Math.min(balance + interest, minPayment);
    balance = balance + interest - payment;
    if (balance < 0.01) balance = 0;
    const d = new Date(firstYear, firstMonth + m, 1);
    schedule.push({ year: d.getFullYear(), monthIdx: d.getMonth(), payment, balanceAfter: balance, interest });
    if (payment <= interest && balance > 0) { schedule._infeasible = true; break; }
    m++;
  }
  return schedule;
}

function getMonthlyEquivalent(item) {
  const a = item.amount || 0;
  if (item.frequency === 'once') {
    if (!item.onceDate) return 0;
    const d = parseLocalDate(item.onceDate);
    const now = new Date();
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() ? a : 0;
  }
  if (item.frequency === 'biannual') return (a * 2) / 12;
  if (item.frequency === 'annual') return a / 12;
  if (item.frequency === 'biweekly') return a * 26 / 12;
  if (item.frequency === 'weekly') return a * 52 / 12;
  return a;
}

function simulateMonthDaily(data, today = new Date()) {
  const t = new Date(today); t.setHours(0,0,0,0);
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
  const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  const startingCash = (data.savings && data.savings.currentBalance) || 0;
  const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const confirms = (data.confirmations && data.confirmations[monthKey]) || {};
  const events = [];
  const clampDay = (day) => Math.min(Math.max(1, day || 1), monthEnd.getDate());

  (data.incomes || []).filter(i => i.active).forEach(i => {
    const freq = i.frequency || 'monthly';
    const key = `inc-${i.id}-${monthKey}`;
    if (freq === 'monthly') {
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), clampDay(i.dayOfMonth || 1)), amount: i.amount || 0, name: i.name, key, confirmed: !!confirms[key] });
    }
  });
  (data.expenses || []).filter(e => e.active).forEach(e => {
    const freq = e.frequency || 'monthly';
    const key = `exp-${e.id}-${monthKey}`;
    if (freq === 'monthly') {
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), clampDay(e.dayOfMonth || 1)), amount: -(e.amount || 0), name: e.name, key, confirmed: !!confirms[key] });
    }
  });
  (data.debts || []).filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).forEach(d => {
    if (isDebtFutureStart(d, t)) {
      const ds = parseLocalDate(d.startDate);
      if (ds && ds >= monthStart && ds <= monthEnd) {
        const key = `debt-${d.id}-${monthKey}`;
        const due = Math.min(d.minimumPayment || 0, d.totalAmount - (d.paidAmount || 0));
        events.push({ date: ds, amount: -due, name: d.name, key, confirmed: !!confirms[key] });
      }
      return;
    }
    const day = clampDay(d.paymentDay || 1);
    const key = `debt-${d.id}-${monthKey}`;
    const due = Math.min(d.minimumPayment || 0, d.totalAmount - (d.paidAmount || 0));
    events.push({ date: new Date(t.getFullYear(), t.getMonth(), day), amount: -due, name: d.name, key, confirmed: !!confirms[key] });
  });

  let realBalanceToday = startingCash;
  events.forEach(ev => { if (ev.confirmed) realBalanceToday += ev.amount; });

  const overdue = events.filter(ev => !ev.confirmed && ev.date < t);
  const future = events.filter(ev => !ev.confirmed && ev.date >= t).sort((a,b) => a.date - b.date);
  let running = realBalanceToday;
  let firstNeg = null, recovery = null, wasNeg = running < 0;
  if (wasNeg) firstNeg = new Date(t);
  overdue.forEach(ev => { running += ev.amount; });
  if (running < 0 && !wasNeg) { firstNeg = new Date(t); wasNeg = true; }
  if (wasNeg && running >= 0) { recovery = new Date(t); wasNeg = false; }

  let idx = 0;
  for (let day = new Date(t); day <= monthEnd; day.setDate(day.getDate() + 1)) {
    while (idx < future.length && future[idx].date.getTime() === day.getTime()) {
      running += future[idx].amount; idx++;
    }
    if (running < 0 && !wasNeg) { firstNeg = new Date(day); wasNeg = true; recovery = null; }
    if (wasNeg && running >= 0) { recovery = new Date(day); wasNeg = false; }
  }
  return { startingCash, realBalanceToday, endOfMonthBalance: running, firstNegativeDate: firstNeg, recoveryDate: recovery, events };
}

function computeCurrentNetWorth(data) {
  const cash = (data.savings && data.savings.currentBalance) || 0;
  const savings = (data.savings && data.savings.current) || 0;
  const debts = (data.debts || []).filter(d => !d.archived).reduce((s, d) => s + Math.max(0, (d.totalAmount || 0) - (d.paidAmount || 0)), 0);
  return { cash, savings, debts, netWorth: cash + savings - debts };
}

// ---------- scenarios ----------

test('parseLocalDate: 2024-07-01 in any TZ stays July 1', () => {
  const d = parseLocalDate('2024-07-01');
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 1);
});

test('parseLocalDate: 2024-01-01 stays Jan 1 (timezone bug protection)', () => {
  const d = parseLocalDate('2024-01-01');
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
});

test('Daily sim: $1M cash, no events → balance stays $1M', () => {
  const data = { savings: { currentBalance: 1000000 }, incomes: [], expenses: [], debts: [], confirmations: {} };
  const sim = simulateMonthDaily(data, new Date(2026, 4, 15));
  assert.equal(sim.startingCash, 1000000);
  assert.equal(sim.realBalanceToday, 1000000);
  assert.equal(sim.endOfMonthBalance, 1000000);
  assert.equal(sim.firstNegativeDate, null);
});

test('Daily sim: $500K cash, $800K rent on day 5, today is day 10 (overdue), no income → real today reflects overdue rent', () => {
  // Rent should be applied immediately since the day already passed and is unconfirmed
  const data = {
    savings: { currentBalance: 500000 },
    incomes: [],
    expenses: [{ id: 'rent', name: 'Arriendo', amount: 800000, active: true, frequency: 'monthly', dayOfMonth: 5 }],
    debts: [],
    confirmations: {},
  };
  const sim = simulateMonthDaily(data, new Date(2026, 4, 10));
  assert.equal(sim.realBalanceToday, 500000, 'balance today before applying overdue is starting cash');
  // After overdue application, end of month should be -300K (assuming no more events)
  assert.equal(sim.endOfMonthBalance, -300000);
  assert.ok(sim.firstNegativeDate, 'should detect negative period');
});

test('Daily sim: $500K cash, $800K rent day 5, $2M salary day 15, today day 10 → goes negative day 10, recovers day 15', () => {
  const data = {
    savings: { currentBalance: 500000 },
    incomes: [{ id: 'sal', name: 'Salario', amount: 2000000, active: true, frequency: 'monthly', dayOfMonth: 15 }],
    expenses: [{ id: 'rent', name: 'Arriendo', amount: 800000, active: true, frequency: 'monthly', dayOfMonth: 5 }],
    debts: [], confirmations: {},
  };
  const sim = simulateMonthDaily(data, new Date(2026, 4, 10));
  assert.equal(sim.endOfMonthBalance, 1700000, '500K - 800K + 2M = 1.7M EOM');
  assert.ok(sim.firstNegativeDate, 'goes negative after overdue rent applied');
  assert.ok(sim.recoveryDate, 'recovers on salary day');
  assert.equal(sim.recoveryDate.getDate(), 15);
});

test('Daily sim: confirmed payment does NOT double-count', () => {
  const monthKey = '2026-05';
  const data = {
    savings: { currentBalance: 1000000 },
    incomes: [],
    expenses: [{ id: 'rent', name: 'Arriendo', amount: 800000, active: true, frequency: 'monthly', dayOfMonth: 5 }],
    debts: [], confirmations: { [monthKey]: { 'exp-rent-2026-05': { amount: 800000 } } },
  };
  const sim = simulateMonthDaily(data, new Date(2026, 4, 10));
  // Starting cash 1M, rent already confirmed → real today is 1M - 800K = 200K
  // No more events. EOM should also be 200K (NOT 200K - 800K again).
  assert.equal(sim.realBalanceToday, 200000, 'confirmed event subtracts once');
  assert.equal(sim.endOfMonthBalance, 200000, 'confirmed event does not reapply');
});

test('Debt with future startDate (July) is not in May projection', () => {
  const debt = { id: 'd1', name: 'Préstamo', totalAmount: 1200000, paidAmount: 0, minimumPayment: 100000, interestRate: 0, paymentDay: 15, startDate: '2026-07-15' };
  const today = new Date(2026, 4, 20); // May
  assert.equal(isDebtFutureStart(debt, today), true);
  const schedule = simulateDebtPayoff(debt, today);
  // First schedule entry must be July (monthIdx 6), not May
  assert.equal(schedule[0].year, 2026);
  assert.equal(schedule[0].monthIdx, 6);
});

test('Debt minimum that does not cover interest is flagged infeasible', () => {
  const debt = { id: 'd', name: 'TC', totalAmount: 1000000, paidAmount: 0, minimumPayment: 5000, interestRate: 24, paymentDay: 1 };
  const schedule = simulateDebtPayoff(debt, new Date(2026, 4, 1));
  // Interest at 24% APR = 2%/mo. 2% of 1M = 20K. Min payment 5K < 20K → infeasible
  assert.equal(schedule._infeasible, true);
});

test('Debt: balance after schedule decreases to 0', () => {
  const debt = { id: 'd', name: 'X', totalAmount: 100000, paidAmount: 0, minimumPayment: 20000, interestRate: 0, paymentDay: 1 };
  const schedule = simulateDebtPayoff(debt, new Date(2026, 4, 1));
  assert.equal(schedule.length, 5, '100K / 20K per month = 5 months');
  assert.equal(schedule[schedule.length - 1].balanceAfter, 0);
});

test('Net worth: $1M cash, $500K savings, $300K debt → $1.2M', () => {
  const data = { savings: { currentBalance: 1000000, current: 500000 }, debts: [{ totalAmount: 500000, paidAmount: 200000, archived: false }] };
  const nw = computeCurrentNetWorth(data);
  assert.equal(nw.cash, 1000000);
  assert.equal(nw.savings, 500000);
  assert.equal(nw.debts, 300000);
  assert.equal(nw.netWorth, 1200000);
});

test('Net worth: archived debts do not count', () => {
  const data = { savings: { currentBalance: 100000 }, debts: [{ totalAmount: 500000, paidAmount: 0, archived: true }] };
  assert.equal(computeCurrentNetWorth(data).netWorth, 100000);
});

test('Net worth: fully-paid debt counts as 0 (not negative)', () => {
  const data = { savings: { currentBalance: 100000 }, debts: [{ totalAmount: 500000, paidAmount: 700000, archived: false }] };
  assert.equal(computeCurrentNetWorth(data).debts, 0);
  assert.equal(computeCurrentNetWorth(data).netWorth, 100000);
});

test('getMonthlyEquivalent: monthly → amount', () => {
  assert.equal(getMonthlyEquivalent({ amount: 1000000, frequency: 'monthly' }), 1000000);
});
test('getMonthlyEquivalent: biannual → amount * 2 / 12', () => {
  assert.equal(getMonthlyEquivalent({ amount: 1000000, frequency: 'biannual' }), 1000000 * 2 / 12);
});
test('getMonthlyEquivalent: weekly → amount * 52 / 12', () => {
  assert.equal(getMonthlyEquivalent({ amount: 100000, frequency: 'weekly' }), 100000 * 52 / 12);
});

// Realistic scenario matching the user's data
test('Realistic scenario: salary 2.4M day 31, bono 1.5M day 31, prima 1M biannual; rent 800K + util 200K + food 600K + sub 300K; 4 debts each ~500K with high min payments', () => {
  const data = {
    savings: { currentBalance: 1000000 },
    incomes: [
      { id: 'sal', name: 'Salario', amount: 2400000, active: true, frequency: 'monthly', dayOfMonth: 31 },
      { id: 'bono', name: 'Bono', amount: 1500000, active: true, frequency: 'monthly', dayOfMonth: 31 },
    ],
    expenses: [
      { id: 'rent', name: 'Arriendo', amount: 800000, active: true, frequency: 'monthly', dayOfMonth: 5 },
      { id: 'util', name: 'Servicios', amount: 200000, active: true, frequency: 'monthly', dayOfMonth: 10 },
      { id: 'food', name: 'Comida', amount: 600000, active: true, frequency: 'monthly', dayOfMonth: 15 },
      { id: 'sub', name: 'Subs', amount: 300000, active: true, frequency: 'monthly', dayOfMonth: 20 },
    ],
    debts: [
      { id: 'd1', name: 'Préstamo Mamá', totalAmount: 500000, paidAmount: 0, minimumPayment: 500000, interestRate: 0, paymentDay: 25 },
      { id: 'd2', name: 'Solventa', totalAmount: 484000, paidAmount: 0, minimumPayment: 484000, interestRate: 0, paymentDay: 25 },
      { id: 'd3', name: 'Descuadre', totalAmount: 300000, paidAmount: 0, minimumPayment: 300000, interestRate: 0, paymentDay: 25 },
      { id: 'd4', name: 'Tarjeta', totalAmount: 960435, paidAmount: 0, minimumPayment: 960435, interestRate: 0, paymentDay: 25 },
    ],
    confirmations: {},
  };
  // On day 1 of the month, nothing confirmed yet, balance = 1M starting
  const sim = simulateMonthDaily(data, new Date(2026, 4, 1));
  // Total income: 2.4 + 1.5 = 3.9M
  // Total expenses: 800K + 200K + 600K + 300K = 1.9M
  // Total debt: 500K + 484K + 300K + 960.435K = 2,244,435
  // Net for month: 3.9M - 1.9M - 2.24M = -244K
  // Starting 1M + net -244K = 756K EOM
  assert.equal(sim.endOfMonthBalance, 756000 - 435, 'EOM = 1M + 3.9M - 1.9M - 2,244,435 = 755,565');
});


// ---------- life-window (vigencia) ----------

function isItemActiveInMonth(item, year, monthIdx) {
  const key = year * 12 + monthIdx;
  if (item.startDate) {
    const sd = parseLocalDate(item.startDate);
    if (sd && !isNaN(sd) && key < sd.getFullYear() * 12 + sd.getMonth()) return false;
  }
  if (item.endDate) {
    const ed = parseLocalDate(item.endDate);
    if (ed && !isNaN(ed) && key > ed.getFullYear() * 12 + ed.getMonth()) return false;
  }
  return true;
}

test('Vigencia: Netflix starts July 30 → inactive in June, active in July and August', () => {
  const netflix = { amount: 22450, frequency: 'monthly', startDate: '2026-07-30' };
  assert.equal(isItemActiveInMonth(netflix, 2026, 5), false, 'June');
  assert.equal(isItemActiveInMonth(netflix, 2026, 6), true, 'July');
  assert.equal(isItemActiveInMonth(netflix, 2026, 7), true, 'August');
});

test('Vigencia: Disney promo ends June → active in June (last month), inactive in July', () => {
  const disney = { amount: 5000, frequency: 'monthly', endDate: '2026-06-30' };
  assert.equal(isItemActiveInMonth(disney, 2026, 5), true, 'June is the last month');
  assert.equal(isItemActiveInMonth(disney, 2026, 6), false, 'July no longer counts');
});

test('Vigencia: no dates → always active', () => {
  assert.equal(isItemActiveInMonth({ amount: 1 }, 2026, 0), true);
  assert.equal(isItemActiveInMonth({ amount: 1 }, 2030, 11), true);
});

test('Checklist math (user real data): income 4.841.812, hogar 2.569.000, personal 123.154, debts 3.041.254 (min due), savings 2M → leftover negative flags overspend', () => {
  const income = 4841812;
  const hogar = 109000 + 150000 + 730000 + 700000 + 80000 + 800000; // 2.569.000
  const personal = 59899 + 8380 + 4975 + 5000 + 44900;              // 123.154
  const debts = 600000 + 1417229 + 991225 + 32800;                  // 3.041.254
  const savings = 2000000;
  const total = hogar + personal + debts + savings;
  assert.equal(hogar, 2569000);
  assert.equal(personal, 123154);
  assert.equal(debts, 3041254);
  assert.equal(total, 7733408);
  const leftover = income - total;
  assert.equal(leftover, -2891596, 'their sheet: paying everything incl. Amor-from-savings exceeds salary — matches their note that Amor is paid from ahorro, not salary');
});

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
