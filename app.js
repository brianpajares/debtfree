const STORAGE_KEY = 'deuda-cero.v1';
const palette = [
  { bg: '#edf2e9', color: '#708b65' },
  { bg: '#f3efe7', color: '#a38960' },
  { bg: '#f0ebf6', color: '#8b78b8' },
  { bg: '#e9f0f1', color: '#678a8b' },
  { bg: '#f4ece8', color: '#aa7865' },
];

const seed = {
  extra: 500,
  strategy: 'avalancha',
  isSample: true,
  debts: [
    { id: 'bcp', name: 'Tarjeta BCP', kind: 'Tarjeta', balance: 6900, initialBalance: 10600, apr: 42, minimum: 450, mark: 'B' },
    { id: 'auto', name: 'Préstamo auto', kind: 'Préstamo', balance: 12200, initialBalance: 15500, apr: 16, minimum: 850, mark: 'A' },
    { id: 'ripley', name: 'Tarjeta Ripley', kind: 'Tarjeta', balance: 3400, initialBalance: 5200, apr: 54, minimum: 240, mark: 'R' },
    { id: 'interbank', name: 'Interbank', kind: 'Tarjeta', balance: 2300, initialBalance: 2700, apr: 29, minimum: 220, mark: 'I' },
  ],
  activity: [
    { id: 'seed-1', debtId: 'bcp', debtName: 'Tarjeta BCP', amount: 1200, date: daysAgo(2), note: 'Pago registrado' },
    { id: 'seed-2', debtId: 'auto', debtName: 'Préstamo auto', amount: 2500, date: daysAgo(37), note: 'Pago registrado' },
    { id: 'seed-3', debtId: 'bcp', debtName: 'Tarjeta BCP', amount: 3000, date: daysAgo(68), note: 'Abono extraordinario' },
    { id: 'seed-4', debtId: 'ripley', debtName: 'Tarjeta Ripley', amount: 1500, date: daysAgo(99), note: 'Pago registrado' },
    { id: 'seed-5', debtId: 'interbank', debtName: 'Interbank', amount: 1000, date: daysAgo(130), note: 'Pago registrado' },
  ],
};

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.debts) && Array.isArray(saved.activity)) {
      return {
        extra: Number.isFinite(saved.extra) ? saved.extra : seed.extra,
        strategy: saved.strategy === 'bola' ? 'bola' : 'avalancha',
        isSample: saved.isSample !== false,
        debts: saved.debts,
        activity: saved.activity,
      };
    }
  } catch (error) {
    console.warn('No se pudo leer el plan guardado; se usará un plan nuevo.', error);
  }
  return structuredClone(seed);
}

let state = loadState();
let activeFilter = 'Todas';
let paymentDebtId = null;
let editingDebtId = null;
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const numberFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const preciseFormat = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currency = (amount) => `S/ ${numberFormat.format(Math.max(0, Math.round(amount)))}`;
const currencyPrecise = (amount) => `S/ ${preciseFormat.format(Math.max(0, amount))}`;
const totalBalance = () => state.debts.reduce((sum, debt) => sum + Math.max(0, Number(debt.balance) || 0), 0);
const minimumTotal = () => state.debts.reduce((sum, debt) => sum + (Number(debt.balance) > 0 ? Math.max(0, Number(debt.minimum) || 0) : 0), 0);
const paidTotal = () => state.debts.reduce((sum, debt) => sum + Math.max(0, (Number(debt.initialBalance) || 0) - (Number(debt.balance) || 0)), 0);
const monthNames = new Intl.DateTimeFormat('es-PE', { month: 'long' });

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('No se pudo guardar el plan en este navegador.', error);
    showToast('No se pudieron guardar los cambios en este navegador.');
  }
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat('es-PE', options).format(new Date(value));
}

function finishDate(monthOffset) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + Math.max(0, monthOffset));
  const month = monthNames.format(date);
  return `${month.charAt(0).toLocaleUpperCase('es-PE')}${month.slice(1)} ${date.getFullYear()}`;
}

function strategyOrder(debts, strategy = state.strategy) {
  return [...debts].sort((a, b) => strategy === 'avalancha'
    ? (Number(b.apr) || 0) - (Number(a.apr) || 0) || (Number(a.balance) || 0) - (Number(b.balance) || 0)
    : (Number(a.balance) || 0) - (Number(b.balance) || 0) || (Number(b.apr) || 0) - (Number(a.apr) || 0));
}

function simulate(extra = state.extra, strategy = state.strategy, minimumOnly = false) {
  const debts = state.debts
    .filter((debt) => Number(debt.balance) > 0)
    .map((debt) => ({ ...debt, balance: Number(debt.balance), minimum: Math.max(.01, Number(debt.minimum) || .01), apr: Math.max(0, Number(debt.apr) || 0) }));
  const order = strategyOrder(debts, strategy).map((debt) => debt.id);
  const baseBudget = minimumTotal() + (minimumOnly ? 0 : Math.max(0, extra));
  const schedule = [{ month: 0, balance: debts.reduce((sum, debt) => sum + debt.balance, 0) }];
  let interest = 0;
  let months = 0;
  const payoffMonths = {};

  while (debts.some((debt) => debt.balance > .009) && months < 600) {
    months += 1;
    let monthInterest = 0;
    for (const debt of debts) {
      if (debt.balance <= .009) continue;
      const accrued = debt.balance * debt.apr / 1200;
      debt.balance += accrued;
      monthInterest += accrued;
    }
    interest += monthInterest;

    let allocated = 0;
    for (const debt of debts) {
      if (debt.balance <= .009) continue;
      const payment = Math.min(debt.balance, debt.minimum);
      debt.balance -= payment;
      allocated += payment;
      if (debt.balance <= .009 && !payoffMonths[debt.id]) payoffMonths[debt.id] = months;
    }

    if (!minimumOnly) {
      let remaining = Math.max(0, baseBudget - allocated);
      for (const id of order) {
        if (remaining <= .009) break;
        const debt = debts.find((item) => item.id === id);
        if (!debt || debt.balance <= .009) continue;
        const payment = Math.min(debt.balance, remaining);
        debt.balance -= payment;
        remaining -= payment;
        if (debt.balance <= .009 && !payoffMonths[debt.id]) payoffMonths[debt.id] = months;
      }
    }

    const remainingBalance = debts.reduce((sum, debt) => sum + Math.max(0, debt.balance), 0);
    schedule.push({ month: months, balance: remainingBalance });
  }

  const complete = debts.every((debt) => debt.balance <= .009);
  return { months, interest, schedule, order, payoffMonths, complete };
}

function chartMarkup(points, color = '#78966d', gradientId = 'chart-fill') {
  const width = 680;
  const height = 220;
  const padX = 4;
  const padY = 13;
  const max = Math.max(1, ...points.map((point) => point.balance));
  const coords = points.map((point, index) => ({
    x: padX + (width - padX * 2) * index / Math.max(1, points.length - 1),
    y: padY + (height - padY * 2) * (1 - point.balance / max),
  }));
  const line = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${coords.at(-1).x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;
  return `<defs><linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity=".015"/></linearGradient></defs><path d="${area}" fill="url(#${gradientId})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${coords.map((point, index) => index === coords.length - 1 ? `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#fff" stroke="${color}" stroke-width="2.5"/>` : '').join('')}`;
}

function renderChart(simulation) {
  const chart = $('#progress-chart');
  const points = [];
  for (let index = 0; index <= 6; index += 1) {
    const targetMonth = index;
    const point = simulation.schedule[Math.min(targetMonth, simulation.schedule.length - 1)] || { balance: 0 };
    points.push({ balance: point.balance });
  }
  chart.innerHTML = chartMarkup(points);
  const startBalance = totalBalance();
  $('#chart-max').textContent = currency(startBalance);
  $('#chart-mid').textContent = currency(startBalance / 2);
  const months = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + index);
    return index === 0 ? 'Hoy' : monthNames.format(date).slice(0, 3);
  });
  $('#chart-labels').innerHTML = months.map((month) => `<span>${month}</span>`).join('');
  $('#chart-note-text').textContent = !simulation.complete
    ? 'Tu pago no alcanza para liquidar la deuda. Aumenta el extra o revisa las tasas.'
    : simulation.months > 0
    ? `Con ${currency(state.extra)} extra al mes, podrías terminar en ${simulation.months} meses.`
    : '¡Lo lograste! No tienes saldos pendientes.';
}

function debtColor(debt) {
  const index = Math.abs([...String(debt.id)].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length;
  return palette[index];
}

function debtProgress(debt) {
  const initial = Math.max(0, Number(debt.initialBalance) || Number(debt.balance) || 0);
  return initial > 0 ? Math.min(100, Math.max(0, (1 - Number(debt.balance) / initial) * 100)) : 0;
}

function debtRow(debt, { table = false } = {}) {
  const colors = debtColor(debt);
  const progress = debtProgress(debt);
  if (table) {
    return `<div class="debt-row" data-debt-id="${escapeHtml(debt.id)}"><div class="debt-identity"><span class="debt-logo" style="--logo-bg:${colors.bg};--logo-color:${colors.color}">${escapeHtml(debt.mark || debt.name.slice(0, 1))}</span><span class="debt-identity-copy"><strong>${escapeHtml(debt.name)}</strong><small>${escapeHtml(debt.kind)}</small></span></div><div class="debt-cell"><strong>${currency(debt.balance)}</strong><br /><small>de saldo</small></div><div class="debt-cell"><span class="apr-chip">${Number(debt.apr).toLocaleString('es-PE')}%</span></div><div class="debt-cell">${currency(debt.minimum)}</div><div class="debt-cell">${Math.round(progress)}%</div><div class="debt-row-actions"><button class="mini-icon-button" type="button" data-pay="${escapeHtml(debt.id)}" aria-label="Registrar pago a ${escapeHtml(debt.name)}" title="Registrar pago"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button><button class="mini-icon-button" type="button" data-edit="${escapeHtml(debt.id)}" aria-label="Editar ${escapeHtml(debt.name)}" title="Editar deuda"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.5 5.5 3 3M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/></svg></button></div></div>`;
  }
  return `<div class="debt-row" data-debt-id="${escapeHtml(debt.id)}"><div class="debt-identity"><span class="debt-logo" style="--logo-bg:${colors.bg};--logo-color:${colors.color}">${escapeHtml(debt.mark || debt.name.slice(0, 1))}</span><span class="debt-identity-copy"><strong>${escapeHtml(debt.name)}</strong><small>${escapeHtml(debt.kind)} · ${Number(debt.apr).toLocaleString('es-PE')}% anual</small></span></div><div class="debt-progress"><div class="debt-progress-track"><span style="width:${progress.toFixed(1)}%"></span></div><small>${Math.round(progress)}% pagado</small></div><strong class="debt-balance">${currency(debt.balance)}</strong><div class="debt-row-actions"><button class="mini-pay-button" type="button" data-pay="${escapeHtml(debt.id)}">Registrar</button></div></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function activityMarkup(item) {
  const date = formatDate(item.date, { day: 'numeric', month: 'short' });
  return `<div class="activity-item"><span class="activity-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8"/></svg></span><span class="activity-item-copy"><strong>${escapeHtml(item.note || 'Pago registrado')} · ${escapeHtml(item.debtName)}</strong><small>${date} · Un paso más hacia tu meta</small></span><strong class="activity-amount">− ${currency(item.amount)}</strong></div>`;
}

function renderActivities() {
  const sorted = [...state.activity].sort((a, b) => new Date(b.date) - new Date(a.date));
  $('#dashboard-activity-list').innerHTML = sorted.slice(0, 2).map(activityMarkup).join('') || '<div class="empty-state"><small>Tu primer logro aparecerá aquí.</small></div>';
  $('#full-activity-list').innerHTML = sorted.map(activityMarkup).join('');
  $('#activity-empty').hidden = sorted.length > 0;
  $('#history-count').textContent = `${sorted.length} ${sorted.length === 1 ? 'movimiento' : 'movimientos'}`;
  $('#activity-total-paid').textContent = currency(paidTotal());
}

function renderDebtLists(simulation) {
  const ordered = strategyOrder(state.debts.filter((debt) => debt.balance > 0));
  $('#dashboard-debt-list').innerHTML = ordered.slice(0, 4).map((debt) => debtRow(debt)).join('') || '<div class="empty-state"><strong>¡Qué sensación!</strong><small>Ya no tienes deudas pendientes.</small></div>';
  const tableLabels = '<div class="table-labels"><span>CUENTA</span><span>SALDO ACTUAL</span><span>INTERÉS</span><span>MÍNIMO</span><span>PAGADO</span><span></span></div>';
  const filtered = state.debts.filter((debt) => debt.balance > 0 && (activeFilter === 'Todas' || debt.kind === activeFilter));
  $('#all-debt-list').innerHTML = tableLabels + filtered.map((debt) => debtRow(debt, { table: true })).join('');
  $('#debt-empty').hidden = filtered.length > 0;
  $('#debt-count').textContent = state.debts.filter((debt) => debt.balance > 0).length;
  $('#stat-debt-count').textContent = `${state.debts.filter((debt) => debt.balance > 0).length} ${state.debts.filter((debt) => debt.balance > 0).length === 1 ? 'cuenta' : 'cuentas'}`;
  const avgApr = totalBalance() > 0 ? state.debts.reduce((sum, debt) => sum + debt.balance * debt.apr, 0) / totalBalance() : 0;
  $('#debt-page-total').textContent = currency(totalBalance());
  $('#debt-page-minimum').textContent = currency(minimumTotal());
  $('#debt-page-apr').textContent = `${avgApr.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`;
  $('#payoff-order-list').innerHTML = ordered.map((debt, index) => {
    const payoffMonth = simulation.payoffMonths[debt.id];
    const monthsAway = payoffMonth ? `Meta en ${payoffMonth} ${payoffMonth === 1 ? 'mes' : 'meses'}` : 'Después de la meta anterior';
    return `<div class="payoff-row"><span class="payoff-number">${index + 1}</span><span><strong>${escapeHtml(debt.name)}</strong><br /><small>${monthsAway}</small></span><small>${Number(debt.apr).toLocaleString('es-PE')}% anual</small><span class="payoff-balance">${currency(debt.balance)}</span></div>`;
  }).join('') || '<div class="empty-state"><span>✦</span><strong>Tu meta ya es realidad.</strong></div>';
}

function render() {
  const balance = totalBalance();
  const currentPlan = simulate(state.extra, state.strategy);
  const minimumPlan = simulate(0, state.strategy, true);
  const savings = Math.max(0, minimumPlan.interest - currentPlan.interest);
  const progress = state.debts.reduce((sum, debt) => sum + (Number(debt.initialBalance) || 0), 0) > 0
    ? Math.min(100, paidTotal() / state.debts.reduce((sum, debt) => sum + (Number(debt.initialBalance) || 0), 0) * 100)
    : 100;
  const monthly = balance > 0 ? minimumTotal() + Number(state.extra || 0) : 0;
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const paidThisMonth = state.activity.filter((item) => String(item.date).slice(0, 7) === currentMonthKey).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  $('#total-debt').textContent = currency(balance);
  $('#monthly-payment').textContent = currency(monthly);
  $('#paid-this-month').textContent = currency(paidThisMonth);
  $('#interest-saved').textContent = currency(savings);
  $('#plan-monthly-total').textContent = currency(monthly);
  $('#simulator-monthly-total').textContent = currency(monthly);
  $('#hero-progress-label').textContent = `${Math.round(progress)}%`;
  $('#hero-progress-bar').style.width = `${progress}%`;
  $('#hero-paid-label').textContent = `${currency(paidTotal())} pagados hasta hoy`;
  const projectedDate = currentPlan.complete ? finishDate(currentPlan.months) : 'Ajusta tu plan';
  $('#freedom-date').textContent = projectedDate;
  $('#simulator-date').textContent = projectedDate;
  $('#simulator-months').textContent = currentPlan.complete ? `${currentPlan.months} ${currentPlan.months === 1 ? 'mes' : 'meses'}` : 'Sin fecha estimada';
  $('#simulator-interest').textContent = currentPlan.complete ? currency(currentPlan.interest) : 'Sin estimación';
  const savingsLabel = currentPlan.complete && minimumPlan.complete ? currency(savings) : 'Sin estimación';
  $('#interest-saved').textContent = savingsLabel;
  $('#simulator-savings').textContent = savingsLabel;
  $('#strategy-name').textContent = state.strategy === 'avalancha' ? 'Avalancha' : 'Bola de nieve';
  $('#strategy-caption').textContent = state.strategy === 'avalancha' ? 'Menos intereses, más ahorro' : 'Victorias rápidas, más impulso';
  const firstDebt = strategyOrder(state.debts.filter((debt) => debt.balance > 0))[0];
  $('#next-debt-name').textContent = firstDebt ? `Pagar ${firstDebt.name}` : 'Celebrar tu libertad';
  $('#next-debt-copy').textContent = firstDebt ? 'Una cuenta menos, más tranquilidad' : 'Tu esfuerzo te trajo hasta aquí.';
  $('#extra-value').textContent = currency(state.extra);
  $('#extra-range').value = String(Math.min(2000, Math.max(0, state.extra)));
  const sliderPercent = Number($('#extra-range').value) / 2000 * 100;
  $('#extra-range').style.background = `linear-gradient(90deg, #92ab77 ${sliderPercent}%, #e6ebe2 ${sliderPercent}%)`;
  $('#today-label').textContent = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  renderChart(currentPlan);
  renderDebtLists(currentPlan);
  renderActivities();
  const simulatorPoints = currentPlan.schedule.filter((_, index) => index % Math.max(1, Math.ceil(currentPlan.schedule.length / 12)) === 0 || index === currentPlan.schedule.length - 1);
  $('#simulator-chart').innerHTML = `<svg viewBox="0 0 680 220" preserveAspectRatio="none" aria-label="Proyección de tu saldo">${chartMarkup(simulatorPoints, '#8aa477', 'simulator-fill')}</svg>`;
  $$('.strategy-option').forEach((button) => {
    const active = button.dataset.strategy === state.strategy;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  $('#activity-export').disabled = state.activity.length === 0;
  $('#activity-export').style.opacity = state.activity.length === 0 ? '.55' : '1';
  $('#sample-pill').hidden = !state.isSample;
}

function setView(name) {
  const views = ['resumen', 'deudas', 'plan', 'actividad'];
  const selected = views.includes(name) ? name : 'resumen';
  $$('.view').forEach((view) => {
    const active = view.id === `view-${selected}`;
    view.classList.toggle('active', active);
    view.hidden = !active;
  });
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === selected));
  const labels = { resumen: 'Resumen', deudas: 'Mis deudas', plan: 'Mi plan', actividad: 'Actividad' };
  $('#page-breadcrumb').textContent = labels[selected];
  history.replaceState(null, '', `#${selected}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  $('#toast-message').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3300);
}

function openAddDialog() {
  editingDebtId = null;
  $('#debt-form').reset();
  $('#modal-title').textContent = 'Agrega una deuda';
  $('#debt-submit-button').innerHTML = 'Guardar deuda <span>→</span>';
  $('#add-modal').showModal();
  $('#debt-name').focus();
}

function openEditDialog(id) {
  const debt = state.debts.find((item) => item.id === id);
  if (!debt) return;
  editingDebtId = id;
  $('#debt-name').value = debt.name;
  $('#debt-kind').value = debt.kind;
  $('#debt-balance').value = debt.balance;
  $('#debt-apr').value = debt.apr;
  $('#debt-min').value = debt.minimum;
  $('#modal-title').textContent = 'Actualiza tu deuda';
  $('#debt-submit-button').innerHTML = 'Guardar cambios <span>→</span>';
  $('#add-modal').showModal();
  $('#debt-name').focus();
}

function openPaymentDialog(id) {
  const debt = state.debts.find((item) => item.id === id);
  if (!debt) return;
  paymentDebtId = id;
  $('#payment-debt-label').textContent = `${debt.name} · saldo actual ${currency(debt.balance)}. Cada pago cuenta.`;
  $('#payment-amount').value = '';
  $('#payment-amount').max = debt.balance;
  $('#payment-modal').showModal();
  $('#payment-amount').focus();
}

function registerPayment(amount, debtId) {
  const debt = state.debts.find((item) => item.id === debtId);
  if (!debt) return;
  const paid = Math.min(Number(amount), Number(debt.balance));
  if (!(paid > 0)) return;
  debt.balance = Math.max(0, Number(debt.balance) - paid);
  if (debt.balance < .005) debt.balance = 0;
  state.activity.unshift({
    id: createId(),
    debtId: debt.id,
    debtName: debt.name,
    amount: paid,
    date: new Date().toISOString(),
    note: paid >= Number(debt.minimum) ? 'Pago registrado' : 'Abono registrado',
  });
  saveState();
  render();
  showToast(debt.balance === 0 ? `¡${debt.name} ya está pagada! Celebra este logro.` : `Pago de ${currency(paid)} registrado. Vas muy bien.`);
}

function exportActivity() {
  if (!state.activity.length) return;
  const rows = [['Fecha', 'Cuenta', 'Movimiento', 'Monto'], ...[...state.activity]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((item) => [formatDate(item.date), item.debtName, item.note || 'Pago registrado', Number(item.amount).toFixed(2)])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = 'mi-historial-deuda-cero.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast('Tu historial ya está listo para guardar.');
}

document.addEventListener('click', (event) => {
  const viewTrigger = event.target.closest('[data-view]');
  if (viewTrigger) setView(viewTrigger.dataset.view);
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) setView(viewLink.dataset.viewLink);
  if (event.target.closest('[data-open-add]')) openAddDialog();
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) closeButton.closest('dialog')?.close();
  const editButton = event.target.closest('[data-edit]');
  if (editButton) openEditDialog(editButton.dataset.edit);
  const payButton = event.target.closest('[data-pay]');
  if (payButton) openPaymentDialog(payButton.dataset.pay);
  if (event.target.closest('[data-reset-demo]')) {
    if (window.confirm('Esto quitará las cuentas y movimientos de ejemplo. Podrás agregar tus saldos reales después. ¿Continuar?')) {
      state = { extra: 500, strategy: 'avalancha', isSample: false, debts: [], activity: [] };
      activeFilter = 'Todas';
      saveState();
      render();
      showToast('Listo. Ahora puedes comenzar con tus propios datos.');
    }
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    activeFilter = filter.dataset.filter;
    $$('.filter-pill').forEach((button) => button.classList.toggle('active', button === filter));
    renderDebtLists(simulate(state.extra, state.strategy));
  }
  const strategy = event.target.closest('[data-strategy]');
  if (strategy) {
    state.strategy = strategy.dataset.strategy;
    saveState();
    render();
  }
});

$('#debt-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get('name')).trim();
  const balance = Number(form.get('balance'));
  const apr = Number(form.get('apr'));
  const minimum = Number(form.get('minimum'));
  if (!name || ![balance, minimum, apr].every(Number.isFinite) || !(balance > 0) || !(minimum > 0) || apr < 0 || apr > 100) {
    showToast('Revisa el saldo, la tasa y el pago mínimo antes de guardar.');
    return;
  }
  const kind = String(form.get('kind'));
  let debt;
  if (editingDebtId) {
    debt = state.debts.find((item) => item.id === editingDebtId);
    if (!debt) return;
    const progressSoFar = Math.max(0, Number(debt.initialBalance || debt.balance) - Number(debt.balance));
    Object.assign(debt, { name, kind, balance, initialBalance: balance + progressSoFar, apr, minimum, mark: name.slice(0, 1).toLocaleUpperCase('es-PE') });
  } else {
    debt = { id: createId(), name, kind, balance, initialBalance: balance, apr, minimum, mark: name.slice(0, 1).toLocaleUpperCase('es-PE') };
    state.debts.push(debt);
  }
  saveState();
  $('#add-modal').close();
  const wasEditing = Boolean(editingDebtId);
  editingDebtId = null;
  render();
  if (!wasEditing) setView('deudas');
  showToast(wasEditing ? `${debt.name} ya refleja tu saldo actual.` : `${debt.name} ya está en tu plan. Un paso más hacia la claridad.`);
});

$('#payment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = Number(new FormData(event.currentTarget).get('amount'));
  if (!(amount > 0)) {
    showToast('Escribe un monto mayor a cero para registrar tu pago.');
    return;
  }
  $('#payment-modal').close();
  registerPayment(amount, paymentDebtId);
  paymentDebtId = null;
});

$('#extra-range').addEventListener('input', (event) => {
  state.extra = Number(event.target.value);
  saveState();
  render();
});

$('#activity-export').addEventListener('click', exportActivity);
$('#notification-button').addEventListener('click', () => showToast('No tienes pendientes. Un buen momento para respirar.'));
$('.profile-button').addEventListener('click', () => showToast('Este es tu espacio personal. Tus datos se guardan en este dispositivo.'));
$$('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

const firstView = location.hash.replace('#', '');
setView(['resumen', 'deudas', 'plan', 'actividad'].includes(firstView) ? firstView : 'resumen');
render();
