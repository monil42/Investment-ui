'use strict';
const API = 'https://api.github.com';
const PALETTE = ['#2e6ff0', '#16a34a', '#d97706', '#7c5cff', '#06b6d4', '#e2683c', '#0ea5e9'];
let SHA = null, PF = null, LAST = null, TOASTS = null;

/* ---------- storage (remember toggle: localStorage vs sessionStorage) ---------- */
function getCfg() {
  const g = k => sessionStorage.getItem(k) ?? localStorage.getItem(k) ?? '';
  return { owner: g('ia_owner'), repo: g('ia_repo'), token: g('ia_token'),
           remember: localStorage.getItem('ia_remember') !== '0' };
}
function saveCfg(owner, repo, token, remember) {
  ['ia_owner', 'ia_repo', 'ia_token'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
  localStorage.setItem('ia_remember', remember ? '1' : '0');
  const s = remember ? localStorage : sessionStorage;
  s.setItem('ia_owner', owner); s.setItem('ia_repo', repo); s.setItem('ia_token', token);
}
function forget() { ['ia_owner', 'ia_repo', 'ia_token'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); }
function hasToken() { return !!getCfg().token; }

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(x) { return (x == null || isNaN(x)) ? 'n/a' : '$' + Number(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(x) { return (x == null || isNaN(x)) ? 'n/a' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%'); }
function b64ToUtf8(b) { const bin = atob(b.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
function utf8ToB64(s) { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach(x => bin += String.fromCharCode(x)); return btoa(bin); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg, kind, ms) {
  const t = document.createElement('div'); t.className = 'toast ' + (kind || 'info'); t.textContent = msg;
  TOASTS.appendChild(t); setTimeout(() => t.remove(), ms || 4500);
}
function colorClass(c) { return ['green', 'blue', 'amber', 'red', 'gray'].includes(c) ? c : 'gray'; }
function chip(text, color) { return `<span class="chip c-${colorClass(color)}">${esc(text)}</span>`; }
function arw(a, color) { return `<span class="arw a-${colorClass(color)}">${esc(a || '')}</span>`; }

/* ---------- GitHub API ---------- */
async function gh(method, path, body) {
  const { token } = getCfg();
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
    });
  } catch (e) { return { ok: false, status: 0 }; }
  let data = null; try { data = await res.json(); } catch (_) {}
  const rl = res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0';
  return { ok: res.ok, status: res.status, data, rateLimited: rl };
}
function apiErr(r, ctx) {
  if (r.status === 0) return ctx + ': network error — check your connection.';
  if (r.rateLimited) return 'GitHub rate limit reached — wait a minute, then retry.';
  if (r.status === 401) return 'Token rejected (401) — re-check it in Settings.';
  if (r.status === 403) return ctx + ': forbidden (403) — token may lack a permission.';
  if (r.status === 404) return ctx + ': not found (404) — check owner/repo and token scope.';
  if (r.status === 409) return ctx + ': conflict (409) — data changed; reload and retry.';
  return ctx + ': HTTP ' + r.status + '.';
}

/* ---------- views / connection ---------- */
function showView(v) {
  ['dashboard', 'holdings', 'settings'].forEach(x => {
    $('view-' + x).classList.toggle('hidden', x !== v);
    $('tab-' + x).classList.toggle('active', x === v);
  });
}
function setConn(on, label) {
  $('connpill').className = 'connpill ' + (on ? 'on' : 'off');
  $('connText').textContent = on ? (label || 'Connected') : 'Not connected';
}
async function connect(opts) {
  const owner = $('s_owner').value.trim(), repo = $('s_repo').value.trim(), token = $('s_token').value.trim();
  if (!owner || !repo || !token) { toast('Fill in username, repo and token.', 'err'); return; }
  saveCfg(owner, repo, token, $('s_remember').checked);
  const r = await gh('GET', `/repos/${owner}/${repo}`);
  if (r.ok) {
    setConn(true, owner + '/' + repo);
    $('s_status').textContent = '✓ Connected to ' + owner + '/' + repo;
    if (!opts || !opts.silent) { toast('Connected ✓', 'ok'); showView('dashboard'); }
    await loadHoldings(); await loadRecs(false);
  } else {
    setConn(false);
    $('s_status').textContent = apiErr(r, 'Connect');
    toast(apiErr(r, 'Connect'), 'err', 6000);
  }
}
function doForget() { forget(); $('s_token').value = ''; setConn(false); $('s_status').textContent = 'Token forgotten on this device.'; toast('Token forgotten.', 'ok'); }

/* ---------- holdings editor ---------- */
async function loadHoldings() {
  const { owner, repo } = getCfg();
  const r = await gh('GET', `/repos/${owner}/${repo}/contents/portfolio.json?ref=main`);
  if (!r.ok) { toast(apiErr(r, 'Load holdings'), 'err'); return; }
  try { SHA = r.data.sha; PF = JSON.parse(b64ToUtf8(r.data.content)); }
  catch (e) { toast('portfolio.json is not valid JSON.', 'err'); return; }
  renderHoldings();
}
function holdRow(t, s, c) {
  const tr = document.createElement('tr');
  const cell = node => { const td = document.createElement('td'); td.appendChild(node); return td; };
  const inp = (cls, val, num) => { const i = document.createElement('input'); i.className = cls; if (num) { i.type = 'number'; i.step = 'any'; } i.value = (val == null ? '' : val); return i; };
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'remove'; x.addEventListener('click', () => tr.remove());
  tr.append(cell(inp('tickerin', t)), cell(inp('numin', s, true)), cell(inp('numin', c, true)), cell(x));
  return tr;
}
function renderHoldings() {
  const tb = $('holdRows'); tb.innerHTML = '';
  const hs = (PF && PF.holdings) || [];
  if (!hs.length) tb.appendChild(holdRow());
  else hs.forEach(h => tb.appendChild(holdRow(h.ticker, h.shares, h.cost_value)));
}
async function saveHoldings() {
  if (!PF) { toast('Connect first (Settings tab).', 'err'); return; }
  const out = [];
  for (const tr of $('holdRows').querySelectorAll('tr')) {
    const [tk, sh, co] = tr.querySelectorAll('input');
    const ticker = (tk.value || '').trim().toUpperCase(); if (!ticker) continue;
    const shares = parseFloat(sh.value); if (isNaN(shares)) { toast('Enter valid shares for ' + ticker, 'err'); return; }
    const prev = (PF.holdings || []).find(h => (h.ticker || '').toUpperCase() === ticker);
    const h = { ticker, name: (prev && prev.name) || ticker, shares };
    const cost = parseFloat(co.value); if (!isNaN(cost)) h.cost_value = cost;
    out.push(h);
  }
  if (!out.length) { toast('Add at least one holding.', 'err'); return; }
  PF.holdings = out; PF.pending_orders = PF.pending_orders || []; PF.watchlist = PF.watchlist || [];
  const btn = $('saveBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Saving…';
  const { owner, repo } = getCfg();
  const put = () => gh('PUT', `/repos/${owner}/${repo}/contents/portfolio.json`,
    { message: 'update holdings via web', content: utf8ToB64(JSON.stringify(PF, null, 2) + '\n'), sha: SHA });
  let r = await put();
  if (r.status === 409) { const g = await gh('GET', `/repos/${owner}/${repo}/contents/portfolio.json?ref=main`); if (g.ok) { SHA = g.data.sha; r = await put(); } }
  btn.disabled = false; btn.textContent = old;
  if (r.ok) { SHA = r.data.content.sha; toast('Holdings saved ✓ — hit "Refresh analysis" to update recommendations.', 'ok', 6500); }
  else toast(apiErr(r, 'Save holdings'), 'err', 6000);
}

/* ---------- recommendations ---------- */
async function loadRecs(announce) {
  const c = getCfg(); if (!c.owner || !c.token) return;
  const r = await gh('GET', `/repos/${c.owner}/${c.repo}/contents/data/latest.json?ref=main&t=${Date.now()}`);
  if (r.status === 404) { $('recsEmpty').classList.remove('hidden'); return; }
  if (!r.ok) { toast(apiErr(r, 'Load recommendations'), 'err'); return; }
  try { LAST = JSON.parse(b64ToUtf8(r.data.content)); } catch (e) { toast('latest.json is invalid.', 'err'); return; }
  $('recsEmpty').classList.add('hidden');
  renderRecs(LAST);
  if (announce) toast('Recommendations updated ✓', 'ok');
}
function renderRecs(d) {
  const k = $('kpis'); k.innerHTML = '';
  const tiles = [
    { v: money(d.portfolio_value), l: 'Portfolio value', cls: '' },
    { v: String((d.holdings || []).length), l: 'Holdings', cls: '' },
    { v: d.biggest_position ? (esc(d.biggest_position) + ' ' + (d.biggest_weight_pct ?? '?') + '%') : '—', l: 'Biggest position', cls: (d.biggest_weight_pct > 50 ? 'alert' : '') },
    { v: (d.leaders && d.leaders[0]) ? esc(d.leaders[0].ticker) : '—', l: 'Top idea', cls: 'accent' },
  ];
  tiles.forEach(t => { const e = document.createElement('div'); e.className = 'kpi ' + t.cls;
    const v = document.createElement('div'); v.className = 'v'; v.innerHTML = t.v;
    const l = document.createElement('div'); l.className = 'l'; l.textContent = t.l; e.append(v, l); k.appendChild(e); });

  $('updated').textContent = d.generated ? ('Updated ' + d.generated.replace('T', ' ')) : '';
  const cn = $('concNote');
  if (d.biggest_position && d.biggest_weight_pct > 50) {
    cn.innerHTML = `⚠️ <b>${esc(d.biggest_position)} is ${d.biggest_weight_pct}%</b> of your portfolio — high single-stock risk. Spreading out lowers risk.`;
    cn.classList.remove('hidden');
  } else cn.classList.add('hidden');

  const hs = (d.holdings || []).filter(h => h.weight_pct != null && h.weight_pct > 0);
  drawDonut($('donut'), hs.map((h, i) => ({ label: h.ticker, value: h.weight_pct, color: (h.weight_pct > 50 ? '#dc2626' : PALETTE[i % PALETTE.length]) })), d.portfolio_value);
  drawBars($('scoreBars'), (d.holdings || []).filter(h => h.score != null).map(h => ({ label: h.ticker, value: h.score, color: colorClass(h.color) })), 100, v => Math.round(v));

  $('holdReco').innerHTML = (d.holdings || []).map(h => `<tr>
    <td class="tk">${esc(h.ticker)}</td><td>${money(h.price)}</td>
    <td>${h.score == null ? 'n/a' : Math.round(h.score)}</td>
    <td>${arw(h.arrow, h.color)}${esc(h.call)}</td>
    <td>${esc(h.confidence || '')}</td>
    <td class="pill">${h.range_lo != null ? money(h.range_lo) + '–' + money(h.range_hi) : 'n/a'}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">No holdings.</td></tr>';

  const candRow = c => `<tr>
    <td class="tk">${esc(c.ticker)}${c.held ? ' <span class="pill">(held)</span>' : ''}</td>
    <td>${money(c.price)}</td><td>${c.score == null ? '' : Math.round(c.score)}</td>
    <td>${arw(c.arrow, c.color)}${esc(c.call)}</td><td>${pct(c.upside_pct)}</td></tr>`;
  $('ideaTable').innerHTML = (d.leaders || []).map(candRow).join('') || '<tr><td colspan="5" class="empty">—</td></tr>';
  $('lagTable').innerHTML = (d.laggards || []).map(candRow).join('') || '<tr><td colspan="5" class="empty">—</td></tr>';
  if (d.disclaimer) $('foot').textContent = d.disclaimer;
}

/* ---------- charts (no external libs) ---------- */
function drawDonut(container, items, total) {
  container.innerHTML = '';
  if (!items.length) { container.innerHTML = '<div class="empty">No allocation data.</div>'; return; }
  const sum = items.reduce((s, i) => s + i.value, 0) || 1; let acc = 0; const stops = [];
  items.forEach(i => { const a = acc / sum * 360, b = (acc + i.value) / sum * 360; stops.push(`${i.color} ${a}deg ${b}deg`); acc += i.value; });
  const ring = document.createElement('div'); ring.className = 'donut'; ring.style.background = `conic-gradient(${stops.join(',')})`;
  const ctr = document.createElement('div'); ctr.className = 'ctr';
  const b = document.createElement('b'); b.textContent = total != null ? ('$' + Math.round(total)) : '';
  const sp = document.createElement('span'); sp.textContent = 'total'; ctr.append(b, sp); ring.appendChild(ctr);
  const leg = document.createElement('div'); leg.className = 'legend';
  items.forEach(i => { const row = document.createElement('div'); row.className = 'legrow';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = i.color;
    const nm = document.createElement('span'); nm.textContent = i.label;
    const pc = document.createElement('span'); pc.className = 'pc'; pc.textContent = (i.value / sum * 100).toFixed(0) + '%';
    row.append(sw, nm, pc); leg.appendChild(row); });
  const wrap = document.createElement('div'); wrap.className = 'donutwrap'; wrap.append(ring, leg); container.appendChild(wrap);
}
function drawBars(container, items, max, fmt) {
  container.innerHTML = '';
  if (!items.length) { container.innerHTML = '<div class="empty">No data.</div>'; return; }
  const box = document.createElement('div'); box.className = 'bars';
  items.forEach(i => {
    const row = document.createElement('div'); row.className = 'bar';
    const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = i.label;
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.className = 'fill ' + (i.color || 'blue');
    fill.style.width = Math.max(2, Math.min(100, i.value / max * 100)) + '%';
    track.appendChild(fill);
    const val = document.createElement('div'); val.className = 'val'; val.textContent = fmt ? fmt(i.value) : i.value;
    row.append(lab, track, val); box.appendChild(row);
  });
  container.appendChild(box);
}

/* ---------- run workflows ---------- */
async function latestRun(file) {
  const { owner, repo } = getCfg();
  const r = await gh('GET', `/repos/${owner}/${repo}/actions/workflows/${file}/runs?per_page=1`);
  return (r.ok && r.data.workflow_runs) ? (r.data.workflow_runs[0] || null) : null;
}
async function runWorkflow(file, btn, onDone) {
  if (!hasToken()) { toast('Connect first (Settings tab).', 'err'); return; }
  const { owner, repo } = getCfg();
  const prev = await latestRun(file); const prevId = prev ? prev.id : 0;
  btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Working…';
  const r = await gh('POST', `/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`, { ref: 'main' });
  if (r.status !== 204) { btn.disabled = false; btn.innerHTML = old; toast(apiErr(r, 'Start workflow') + ' (token needs Actions: write)', 'err', 6000); return; }
  toast('Started on GitHub — about 1–2 minutes…', 'info', 3000);
  for (let i = 0; i < 26; i++) {
    await sleep(7000);
    const run = await latestRun(file);
    if (run) {
      const link = $('runLink'); link.href = run.html_url; link.classList.remove('hidden');
      if (run.id !== prevId && run.status === 'completed') {
        btn.disabled = false; btn.innerHTML = old;
        if (run.conclusion === 'success') { if (onDone) await onDone(); }
        else toast('Run finished: ' + run.conclusion + ' — open the run link for details.', 'err', 7000);
        return;
      }
    }
  }
  btn.disabled = false; btn.innerHTML = old; toast('Still running — open the run link, then press Reload.', 'info', 7000);
}
function sendReport() { runWorkflow('report.yml', $('sendBtn'), async () => { toast('Report emailed ✓ — check your inbox.', 'ok', 6000); await loadRecs(false); }); }
function refreshRecs() { runWorkflow('analyze-publish.yml', $('refreshBtn'), async () => { await loadRecs(true); }); }

/* ---------- init ---------- */
function init() {
  TOASTS = $('toasts');
  ['dashboard', 'holdings', 'settings'].forEach(v => $('tab-' + v).addEventListener('click', () => showView(v)));
  $('sendBtn').addEventListener('click', sendReport);
  $('refreshBtn').addEventListener('click', refreshRecs);
  $('reloadBtn').addEventListener('click', () => loadRecs(true));
  $('addBtn').addEventListener('click', () => $('holdRows').appendChild(holdRow()));
  $('saveBtn').addEventListener('click', saveHoldings);
  $('connectBtn').addEventListener('click', () => connect());
  $('forgetBtn').addEventListener('click', doForget);

  const c = getCfg();
  $('s_owner').value = c.owner || 'monil42';
  $('s_repo').value = c.repo || 'Investment';
  $('s_token').value = c.token || '';
  $('s_remember').checked = c.remember;

  if (c.owner && c.repo && c.token) { setConn(true, c.owner + '/' + c.repo); showView('dashboard'); connect({ silent: true }); }
  else { setConn(false); showView('settings'); }
}
document.addEventListener('DOMContentLoaded', init);
