// glean read-only viewer — front-end glue.
// Loads the wasm engine, feeds it journal text, renders the read-model.
// No network, no storage: everything below runs in this tab and vanishes
// when it closes.
import init, { analyze_with_config, version } from './glean_wasm.js';

const $ = (id) => document.getElementById(id);
let ENGINE_READY = false;
let MODEL = null;
let SCOPE = 'month'; // 'month' | 'year'
const files = { journal: '', accounts: '', config: '' };

// ── Boot: instantiate wasm ────────────────────────────────────────────────
(async function boot() {
  try {
    await init();               // fetches ./glean_wasm_bg.wasm (needs http, not file://)
    ENGINE_READY = true;
    $('engine-line').textContent = version();
    $('boot-msg').textContent = 'Ready.';
    setTimeout(() => $('boot').classList.add('hide'), 80);
    refreshAnalyzeEnabled();
    // ?demo — auto-load the built-in sample (handy for a live preview link).
    if (new URLSearchParams(location.search).has('demo')) loadSample();
  } catch (e) {
    $('boot-msg').textContent = 'Engine failed to load: ' + e;
    console.error(e);
  }
})();

// ── File intake ───────────────────────────────────────────────────────────
async function readFiles(fileList) {
  // Concatenate multiple .journal files (users often keep per-month/per-year
  // files). accounts.journal / glean.toml are routed by name/extension.
  for (const f of fileList) {
    const text = await f.text();
    const name = f.name.toLowerCase();
    if (name.endsWith('.toml')) {
      files.config = text;
      setHint('config', f.name, true);
    } else if (name === 'accounts.journal' || name.includes('account')) {
      files.accounts = text;
      setHint('accounts', f.name, true);
    } else {
      files.journal = files.journal ? files.journal + '\n' + text : text;
      setHint('journal', f.name, true);
    }
  }
  refreshAnalyzeEnabled();
}

function setHint(which, label, ok) {
  const el = $('hint-' + which);
  if (!el) return;
  el.textContent = label;
  el.classList.toggle('ok', !!ok);
}

function refreshAnalyzeEnabled() {
  $('analyze').disabled = !(ENGINE_READY && files.journal.trim().length > 0);
}

$('in-journal').addEventListener('change', (e) => {
  files.journal = '';
  readFiles(e.target.files);
});
$('in-accounts').addEventListener('change', (e) => readFiles(e.target.files));
$('in-config').addEventListener('change', (e) => readFiles(e.target.files));

// Drag & drop
const drop = $('drop');
drop.addEventListener('click', () => $('in-journal').click());
['dragover', 'dragenter'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) readFiles(e.dataTransfer.files);
});

// ── Analyze ───────────────────────────────────────────────────────────────
$('analyze').addEventListener('click', runAnalyze);
function loadSample() {
  files.journal = SAMPLE.journal;
  files.accounts = SAMPLE.accounts;
  files.config = SAMPLE.config;
  setHint('journal', 'sample.journal', true);
  setHint('accounts', 'accounts.journal', true);
  setHint('config', 'glean.toml', true);
  refreshAnalyzeEnabled();
  runAnalyze();
}
$('sample').addEventListener('click', loadSample);
$('reset').addEventListener('click', () => {
  $('dash').hidden = true;
  $('intake').hidden = false;
});
$('seg-month').addEventListener('click', () => setScope('month'));
$('seg-year').addEventListener('click', () => setScope('year'));

function runAnalyze() {
  const err = $('intake-err');
  err.hidden = true;
  let json;
  try {
    json = analyze_with_config(files.journal, files.accounts, files.config);
  } catch (e) {
    return showError('Engine error: ' + e);
  }
  let model;
  try { model = JSON.parse(json); } catch (e) { return showError('Bad engine output.'); }
  if (model.error) return showError(model.error);
  if (!model.meta.tx_count) return showError('No transactions found in that journal.');
  MODEL = model;
  $('intake').hidden = true;
  $('dash').hidden = false;
  render();
}

function showError(msg) {
  const err = $('intake-err');
  err.textContent = msg;
  err.hidden = false;
}

function setScope(scope) {
  SCOPE = scope;
  $('seg-month').classList.toggle('is-active', scope === 'month');
  $('seg-year').classList.toggle('is-active', scope === 'year');
  if (MODEL) render();
}

// ── Rendering ───────────────────────────────────────────────────────────────
const money = (s) => {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
};
const signClass = (s) => (Number(s) < 0 ? 'neg' : 'pos');

function render() {
  const m = MODEL;
  const five = SCOPE === 'month' ? m.five_numbers_month : m.five_numbers_year;
  const cats = SCOPE === 'month' ? m.categories_month : m.categories_year;

  $('dash-title').textContent = SCOPE === 'month'
    ? `Dashboard · ${m.period.label}`
    : `Dashboard · ${m.period.year}`;
  $('dash-meta').textContent =
    `${m.meta.tx_count} transactions · ${m.meta.date_min} → ${m.meta.date_max}`
    + (m.meta.config_active ? ' · glean.toml applied' : '');
  $('cat-scope').textContent = SCOPE === 'month' ? '(this month)' : '(this year)';

  // Five-number cards
  $('cards').innerHTML = [
    card('Income', five.total_income, 'pos'),
    card('Expenses', five.total_expenses, 'neg'),
    card('Cash flow', five.net_cash_flow, signClass(five.net_cash_flow)),
    cardRaw('Savings rate', `${five.savings_rate_pct}%`, signClass(five.net_cash_flow)),
    card('Net worth', five.net_worth, signClass(five.net_worth)),
  ].join('');

  renderBars($('categories'), cats.map((c) => ({ name: shortAcct(c.account), value: c.amount })));
  renderTrend($('networth'), m.net_worth_trend);
  renderTithing(m);
  renderEnvelopes(m);
  renderTx(m.transactions);
  $('tx-count').textContent = `(${m.transactions.length})`;
}

function card(label, value, cls) {
  return `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${money(value)}</div></div>`;
}
function cardRaw(label, value, cls) {
  return `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}

function shortAcct(a) {
  return a.replace(/^expenses:/, '').replace(/^income:/, '↑');
}

function renderBars(el, rows) {
  if (!rows.length) { el.innerHTML = '<div class="empty">Nothing to show.</div>'; return; }
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.value)))) || 1;
  el.innerHTML = rows.map((r) => {
    const pct = Math.max(2, (Math.abs(Number(r.value)) / max) * 100);
    return `<div class="bar-row">
      <span class="bar-name" title="${escape(r.name)}">${escape(r.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
      <span class="bar-val">${money(r.value)}</span>
    </div>`;
  }).join('');
}

function renderTrend(el, points) {
  if (!points.length) { el.innerHTML = '<div class="empty">No trend data.</div>'; return; }
  const vals = points.map((p) => Number(p.net_worth));
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = (max - min) || 1;
  el.innerHTML = points.map((p) => {
    const v = Number(p.net_worth);
    const h = Math.max(3, ((v - min) / span) * 100);
    return `<div class="col" title="${p.month}: ${money(p.net_worth)}">
      <span class="stalk ${v < 0 ? 'neg' : ''}" style="height:${h}%"></span>
      <span class="m">${p.month.slice(2)}</span>
    </div>`;
  }).join('');
}

function renderTithing(m) {
  const wrap = $('config-panels');
  const panel = $('tithing-panel');
  if (!m.tithing) { panel.hidden = true; syncConfigPanels(); return; }
  panel.hidden = false; wrap.hidden = false;
  $('tithing-year').textContent = m.tithing.year;
  $('tithing').innerHTML = [
    ['Base income', m.tithing.base],
    ['Rate', m.tithing.rate_pct + '%'],
    ['Owed', money(m.tithing.owed)],
    ['Paid', money(m.tithing.paid)],
    ['Balance', money(m.tithing.balance)],
  ].map(([k, v], i) =>
    `<div class="k">${k}</div><div class="v">${i === 0 ? money(v) : v}</div>`).join('');
}

function renderEnvelopes(m) {
  const panel = $('envelope-panel');
  if (!m.envelopes || !m.envelopes.length) { panel.hidden = true; syncConfigPanels(); return; }
  panel.hidden = false; $('config-panels').hidden = false;
  renderBars($('envelopes'), m.envelopes.map((e) => ({ name: e.name, value: e.spent })));
}

function syncConfigPanels() {
  const anyShown = !$('tithing-panel').hidden || !$('envelope-panel').hidden;
  $('config-panels').hidden = !anyShown;
}

function renderTx(txns) {
  const body = $('tx-body');
  body.innerHTML = txns.map((t) => {
    const cat = (t.postings.find((p) => p.account.startsWith('expenses:') || p.account.startsWith('income:'))
      || t.postings[0] || {}).account || '';
    return `<tr>
      <td>${t.date}</td>
      <td>${escape(t.payee)}</td>
      <td class="num">${money(t.amount)}</td>
      <td><span class="cat-chip">${escape(cat)}</span></td>
      <td class="ctr">${t.reviewed ? '<span class="tick">✓</span>' : '<span class="pending">!</span>'}</td>
    </tr>`;
  }).join('');
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── A tiny built-in sample (so the page is explorable with no file) ─────────
const SAMPLE = {
  journal: `2026-01-02 * Employer Payroll
    assets:checking          $4200.00
    income:salary           -$4200.00

2026-01-06 ! Trader Joe's
    expenses:food:groceries    $148.20
    liabilities:credit:visa   -$148.20

2026-01-09 * Rent
    expenses:housing:rent    $1650.00
    assets:checking         -$1650.00

2026-01-15 * Tithing
    expenses:giving:tithing   $420.00
    assets:checking          -$420.00

2026-02-02 * Employer Payroll
    assets:checking          $4200.00
    income:salary           -$4200.00

2026-02-08 ! Shell Gas
    expenses:transport:fuel     $61.40
    liabilities:credit:visa    -$61.40

2026-02-11 * Rent
    expenses:housing:rent    $1650.00
    assets:checking         -$1650.00

2026-02-19 ! Costco
    expenses:food:groceries    $214.77
    liabilities:credit:visa   -$214.77
`,
  accounts: `account assets:checking
    ; glean-is-budgeted: true
    ; glean-is-trackable: true

account liabilities:credit:visa
    ; glean-is-budgeted: true
    ; glean-is-trackable: true
`,
  config: `[tithing]
base_accounts = ["income:salary"]
exclude_accounts = []
rate = 0.10

[sync]
journal_dir = "."
cache_path = ":memory:"
`,
};
