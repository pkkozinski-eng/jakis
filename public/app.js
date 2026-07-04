// Aplikacja typerska Premier League 2026/27 - logika frontendu (vanilla JS).
'use strict';

const state = {
  token: localStorage.getItem('typer_token') || null,
  player: null,
  round: 1,
  rounds: [],
};

// ---------- Pomocnicze ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDateShort(iso) {
  return new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDateInput(iso) {
  // do <input type="datetime-local"> w czasie lokalnym
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* brak tresci */ }
  if (!res.ok) throw new Error(data.error || ('Blad ' + res.status));
  return data;
}

// ================= AUTH =================
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  if (invite) {
    $('#join-form [name=invite]').value = invite;
    switchAuthTab('join');
    const note = $('#invite-note');
    note.textContent = 'Masz zaproszenie! Wybierz nick i PIN, aby dolaczyc do ligi.';
    note.classList.remove('hidden');
  }
}

function switchAuthTab(tab) {
  $$('[data-authtab]').forEach((b) => b.classList.toggle('active', b.dataset.authtab === tab));
  $('#login-form').classList.toggle('hidden', tab !== 'login');
  $('#join-form').classList.toggle('hidden', tab !== 'join');
  $('#auth-error').classList.add('hidden');
}

function authError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function afterAuth(data) {
  state.token = data.token;
  state.player = data.player;
  localStorage.setItem('typer_token', data.token);
  history.replaceState(null, '', location.pathname);
  await startApp();
}

$$('[data-authtab]').forEach((b) => b.addEventListener('click', () => switchAuthTab(b.dataset.authtab)));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const data = await api('/login', { method: 'POST', body: { nick: f.nick.value, pin: f.pin.value } });
    await afterAuth(data);
  } catch (err) { authError(err.message); }
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const data = await api('/join', { method: 'POST', body: { nick: f.nick.value, pin: f.pin.value, invite: f.invite.value.trim() } });
    await afterAuth(data);
  } catch (err) { authError(err.message); }
});

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('typer_token');
  state.token = null; state.player = null;
  location.reload();
});

// ================= APP =================
async function startApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-nick').textContent = state.player.nick;
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !state.player.isAdmin));

  const cur = await api('/rounds/current');
  state.round = cur.round;
  await loadRounds();
  navigate('matches');
}

async function loadRounds() {
  const data = await api('/rounds');
  state.rounds = data.rounds;
}

const views = {};
function navigate(view) {
  $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const main = $('#main');
  main.innerHTML = '<div class="loading">Ladowanie…</div>';
  views[view]().catch((err) => { main.innerHTML = `<div class="empty">Blad: ${esc(err.message)}</div>`; });
}
$$('.navbtn').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));

function roundSelector(onChange) {
  const opts = state.rounds
    .map((r) => {
      const tag = r.complete ? ' ✓' : r.started ? ' • trwa' : '';
      return `<option value="${r.round}" ${r.round === state.round ? 'selected' : ''}>Kolejka ${r.round}${tag}</option>`;
    })
    .join('');
  const wrap = document.createElement('div');
  wrap.className = 'round-nav';
  wrap.innerHTML = `
    <button id="rn-prev">‹</button>
    <select id="rn-sel">${opts}</select>
    <button id="rn-next">›</button>`;
  const sel = wrap.querySelector('#rn-sel');
  const prev = wrap.querySelector('#rn-prev');
  const next = wrap.querySelector('#rn-next');
  prev.disabled = state.round <= 1;
  next.disabled = state.round >= state.rounds.length;
  sel.addEventListener('change', () => { state.round = Number(sel.value); onChange(); });
  prev.addEventListener('click', () => { if (state.round > 1) { state.round--; onChange(); } });
  next.addEventListener('click', () => { if (state.round < state.rounds.length) { state.round++; onChange(); } });
  return wrap;
}

// ---------- Widok: Kolejka (typowanie) ----------
views.matches = async function () {
  const main = $('#main');
  main.innerHTML = '';
  main.appendChild(roundSelector(() => navigate('matches')));

  const data = await api(`/rounds/${state.round}/matches`);
  const container = document.createElement('div');

  let anyOpen = false;
  for (const m of data.matches) {
    if (!m.locked && !m.finished) anyOpen = true;
    container.appendChild(matchCard(m));
  }
  main.appendChild(container);

  if (anyOpen) {
    const bar = document.createElement('div');
    bar.className = 'save-bar';
    bar.innerHTML = '<button class="btn-primary" id="save-all">Zapisz wszystkie typy</button>';
    main.appendChild(bar);
    bar.querySelector('#save-all').addEventListener('click', () => saveAll(container));
  }
};

function matchCard(m) {
  const el = document.createElement('div');
  el.className = 'match';
  el.dataset.matchId = m.id;

  let statusBadge = '';
  if (m.finished) statusBadge = '<span class="badge done">Zakonczony</span>';
  else if (m.locked) statusBadge = '<span class="badge live">Zablokowany</span>';
  else statusBadge = '<span class="badge open">Otwarty</span>';

  const centre = m.finished
    ? `<div class="result-final">${m.result.home}:${m.result.away}<small>WYNIK</small></div>`
    : m.locked
      ? `<div class="result-final" style="color:var(--muted)">—<small>start</small></div>`
      : `<div class="score-inputs">
           <input type="number" min="0" max="99" class="sc-home" value="${m.myPrediction ? m.myPrediction.home : ''}" inputmode="numeric" />
           <span class="score-sep">:</span>
           <input type="number" min="0" max="99" class="sc-away" value="${m.myPrediction ? m.myPrediction.away : ''}" inputmode="numeric" />
         </div>`;

  let foot = '';
  if (m.myPrediction) {
    const ptsTxt = m.myPoints != null ? `${m.myPoints} pkt` : 'typ zapisany';
    const cls = m.myPoints != null ? (m.myPoints > 0 ? 'pts-pill' : 'pts-pill zero') : 'pts-pill zero';
    foot = `<span class="muted">Twoj typ: <b>${m.myPrediction.home}:${m.myPrediction.away}</b></span>
            <span class="${cls}">${ptsTxt}</span>`;
  } else if (m.locked) {
    foot = '<span class="muted">Nie obstawiles tego meczu</span><span class="pts-pill zero">0 pkt</span>';
  } else {
    foot = '<span class="muted">Wpisz swoj typ</span>';
  }

  let others = '';
  if (m.locked && m.others.length) {
    const rows = m.others.map((o) => `
      <div class="others-row">
        <span class="nick">${esc(o.nick)}</span>
        <span class="pr">${o.home}:${o.away}${o.points != null ? ` · <b>${o.points} pkt</b>` : ''}</span>
      </div>`).join('');
    others = `<details class="others"><summary>Typy innych graczy (${m.others.length})</summary><div class="others-list">${rows}</div></details>`;
  }

  el.innerHTML = `
    <div class="match-top">
      <span class="match-time">${fmtDateTime(m.kickoff)}</span>
      ${statusBadge}
    </div>
    <div class="match-body">
      <div class="team home">${esc(m.home)}</div>
      ${centre}
      <div class="team away">${esc(m.away)}</div>
    </div>
    <div class="match-foot">${foot}</div>
    ${others}`;

  // Autozapis pojedynczego typu przy zmianie (gdy oba pola wypelnione).
  // Pola istnieja tylko gdy mecz nie jest ani zablokowany, ani zakonczony.
  if (!m.locked && !m.finished) {
    const h = el.querySelector('.sc-home');
    const a = el.querySelector('.sc-away');
    const trySave = async () => {
      if (h.value === '' || a.value === '') return;
      try {
        await api('/predictions', { method: 'POST', body: { matchId: m.id, home: Number(h.value), away: Number(a.value) } });
      } catch (err) { toast(err.message, true); }
    };
    h.addEventListener('change', trySave);
    a.addEventListener('change', trySave);
  }
  return el;
}

async function saveAll(container) {
  const preds = [];
  $$('.match', container).forEach((el) => {
    const h = el.querySelector('.sc-home');
    const a = el.querySelector('.sc-away');
    if (h && a && h.value !== '' && a.value !== '') {
      preds.push({ matchId: Number(el.dataset.matchId), home: Number(h.value), away: Number(a.value) });
    }
  });
  if (!preds.length) return toast('Brak typow do zapisania', true);
  try {
    const res = await api('/predictions/bulk', { method: 'POST', body: { predictions: preds } });
    toast(`Zapisano ${res.saved.length} typ(ow)` + (res.skipped.length ? `, pominieto ${res.skipped.length}` : ''));
    await loadRounds();
  } catch (err) { toast(err.message, true); }
}

// ---------- Widok: Tabela kolejki ----------
views['round-table'] = async function () {
  const main = $('#main');
  main.innerHTML = '';
  main.appendChild(roundSelector(() => navigate('round-table')));

  const data = await api(`/rounds/${state.round}/table`);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="section-title">Tabela · Kolejka ${state.round}</div>
    <p class="muted" style="margin-top:-6px">Rozegrane mecze: ${data.finishedMatches}/${data.totalMatches}</p>`;

  if (data.finishedMatches === 0) {
    card.innerHTML += '<div class="empty">Brak rozegranych meczow w tej kolejce.</div>';
  } else {
    card.appendChild(standingsTable(data.rows, ['#', 'Gracz', 'Pkt', 'Dok.', 'Rez.']));
  }
  main.appendChild(card);
};

// ---------- Widok: Klasyfikacja generalna ----------
views.standings = async function () {
  const main = $('#main');
  main.innerHTML = '';
  const data = await api('/standings');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="section-title">🏆 Klasyfikacja generalna</div>';
  if (!data.standings.length || data.standings.every((r) => r.played === 0)) {
    card.innerHTML += '<div class="empty">Jeszcze brak punktow. Klasyfikacja pojawi sie po pierwszych wynikach.</div>';
  } else {
    card.appendChild(standingsTable(data.standings, ['#', 'Gracz', 'Pkt', 'Dok.', 'Rez.']));
    const legend = document.createElement('p');
    legend.className = 'muted';
    legend.style.fontSize = '12px';
    legend.textContent = 'Dok. = dokladne wyniki, Rez. = trafione rezultaty (kryteria remisowe).';
    card.appendChild(legend);
  }
  main.appendChild(card);
  main.appendChild(rulesCard());
};

function standingsTable(rows, headers) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const body = rows.map((r) => `
    <tr class="${r.playerId === state.player.id ? 'me' : ''} ${r.position === 1 ? 'rank1' : ''}">
      <td class="pos">${r.position}</td>
      <td>${esc(r.nick)}${r.playerId === state.player.id ? ' <span class="muted">(Ty)</span>' : ''}</td>
      <td class="num pts">${r.points}</td>
      <td class="num">${r.exact}</td>
      <td class="num">${r.correctResults}</td>
    </tr>`).join('');
  wrap.innerHTML = `<table class="tbl">
    <thead><tr>
      <th class="pos">${headers[0]}</th><th>${headers[1]}</th>
      <th class="num">${headers[2]}</th><th class="num">${headers[3]}</th><th class="num">${headers[4]}</th>
    </tr></thead>
    <tbody>${body}</tbody></table>`;
  return wrap;
}

function rulesCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="section-title">Punktacja</div>
    <ul class="rules-list">
      <li><span>Trafiony rezultat (1 / X / 2)</span><b>2 pkt</b></li>
      <li><span>Trafiona dokladna roznica bramek</span><b>+1 pkt</b></li>
      <li><span>Trafiona liczba bramek gospodarzy</span><b>+1 pkt</b></li>
      <li><span>Trafiona liczba bramek gosci</span><b>+1 pkt</b></li>
      <li><span><b>Dokladny wynik</b> (razem)</span><b>5 pkt</b></li>
    </ul>`;
  return card;
}

// ---------- Widok: Terminarz ----------
views.schedule = async function () {
  const main = $('#main');
  main.innerHTML = '<div class="section-title">📅 Terminarz sezonu</div>';
  const data = await api('/schedule');
  const frag = document.createElement('div');
  for (const r of data.schedule) {
    const det = document.createElement('details');
    det.className = 'sched-round card';
    if (r.round === state.round) det.open = true;
    const rows = r.matches.map((m) => `
      <div class="sched-match">
        <span class="h">${esc(m.home)}</span>
        <span class="mid">${m.finished ? `<b>${m.result.home}:${m.result.away}</b>` : fmtDateShort(m.kickoff)}</span>
        <span class="a">${esc(m.away)}</span>
      </div>`).join('');
    det.innerHTML = `<summary>Kolejka ${r.round}</summary>${rows}`;
    frag.appendChild(det);
  }
  main.appendChild(frag);
};

// ---------- Widok: Panel administratora ----------
views.admin = async function () {
  const main = $('#main');
  main.innerHTML = '<div class="section-title">⚙️ Panel administratora</div>';

  // 1) Wyniki + terminarz danej kolejki
  const resSec = document.createElement('div');
  resSec.className = 'card admin-sec';
  resSec.appendChild(roundSelector(() => navigate('admin')));
  resSec.insertAdjacentHTML('beforeend', '<h3>Wyniki i terminarz — kolejka ' + state.round + '</h3>');
  const matchesData = await api(`/rounds/${state.round}/matches`);
  const list = document.createElement('div');
  for (const m of matchesData.matches) {
    list.appendChild(adminMatchRow(m));
  }
  resSec.appendChild(list);
  main.appendChild(resSec);

  // 2) Zaproszenia
  const invSec = document.createElement('div');
  invSec.className = 'card admin-sec';
  invSec.innerHTML = '<h3>Linki zaproszen</h3>';
  await renderInvites(invSec);
  main.appendChild(invSec);

  // 3) Gracze
  const plSec = document.createElement('div');
  plSec.className = 'card admin-sec';
  plSec.innerHTML = '<h3>Gracze</h3>';
  await renderPlayers(plSec);
  main.appendChild(plSec);

  // 4) Auto-pobieranie
  const apiSec = document.createElement('div');
  apiSec.className = 'card admin-sec';
  apiSec.innerHTML = `<h3>Automatyczne wyniki (football-data.org)</h3>
    <p class="muted" style="font-size:13px">Opcjonalne. Wymaga ustawienia FOOTBALL_DATA_TOKEN w zmiennych srodowiskowych serwera oraz mapowania nazw druzyn (patrz README).</p>
    <button class="btn-sm btn-outline" id="fetch-res">Pobierz wyniki kolejki ${state.round}</button>
    <span id="fetch-msg" class="muted" style="font-size:12px"></span>`;
  apiSec.querySelector('#fetch-res').addEventListener('click', async () => {
    try {
      const r = await api('/admin/fetch-results', { method: 'POST', body: { round: state.round } });
      apiSec.querySelector('#fetch-msg').textContent = r.note || 'OK';
    } catch (err) { toast(err.message, true); }
  });
  main.appendChild(apiSec);
};

function adminMatchRow(m) {
  const row = document.createElement('div');
  row.className = 'admin-match';
  const rh = m.result ? m.result.home : '';
  const ra = m.result ? m.result.away : '';
  row.innerHTML = `
    <div class="names">${esc(m.home)} — ${esc(m.away)}<small>${fmtDateShort(m.kickoff)}${m.finished ? ' · zakonczony' : m.locked ? ' · trwa/po' : ''}</small></div>
    <div class="inline-inputs">
      <input type="number" min="0" max="99" class="ar-h" value="${rh}" />
      <span class="score-sep">:</span>
      <input type="number" min="0" max="99" class="ar-a" value="${ra}" />
    </div>
    <button class="btn-sm ar-save">Zapisz</button>`;

  row.querySelector('.ar-save').addEventListener('click', async () => {
    const h = row.querySelector('.ar-h').value;
    const a = row.querySelector('.ar-a').value;
    if (h === '' || a === '') return toast('Podaj wynik', true);
    try {
      await api('/admin/results', { method: 'POST', body: { matchId: m.id, home: Number(h), away: Number(a) } });
      toast('Wynik zapisany, punkty naliczone');
      await loadRounds();
    } catch (err) { toast(err.message, true); }
  });

  // Przelozenie meczu (rozwijane)
  const resched = document.createElement('details');
  resched.style.gridColumn = '1 / -1';
  resched.innerHTML = `<summary class="muted" style="font-size:12px;cursor:pointer">Przeloz / zmien wynik</summary>
    <div class="inline-inputs" style="margin-top:6px;flex-wrap:wrap">
      <input type="datetime-local" class="ar-dt" value="${fmtDateInput(m.kickoff)}" style="height:38px;border:1.5px solid var(--line);border-radius:8px;padding:0 8px" />
      <button class="btn-sm btn-outline ar-dt-save">Zmien termin</button>
      ${m.finished ? '<button class="btn-sm btn-danger ar-clear">Cofnij wynik</button>' : ''}
    </div>`;
  resched.querySelector('.ar-dt-save').addEventListener('click', async () => {
    try {
      await api('/admin/reschedule', { method: 'POST', body: { matchId: m.id, kickoff: new Date(resched.querySelector('.ar-dt').value).toISOString() } });
      toast('Termin zmieniony');
      navigate('admin');
    } catch (err) { toast(err.message, true); }
  });
  const clr = resched.querySelector('.ar-clear');
  if (clr) clr.addEventListener('click', async () => {
    try { await api('/admin/results/clear', { method: 'POST', body: { matchId: m.id } }); toast('Wynik cofniety'); navigate('admin'); }
    catch (err) { toast(err.message, true); }
  });
  row.appendChild(resched);
  return row;
}

async function renderInvites(sec) {
  const data = await api('/admin/invites');
  const active = data.invites.filter((i) => i.active);
  const base = location.origin;
  const listHtml = active.length
    ? active.map((i) => `
        <div style="margin-bottom:10px">
          <div class="invite-link">${base}/?invite=${i.token}</div>
          <div class="row-between" style="margin-top:4px">
            <span class="muted" style="font-size:12px">${esc(i.note || '')}</span>
            <button class="btn-sm btn-outline" data-copy="${base}/?invite=${i.token}">Kopiuj</button>
            <button class="btn-sm btn-danger" data-deact="${i.token}">Dezaktywuj</button>
          </div>
        </div>`).join('')
    : '<p class="muted">Brak aktywnych linkow.</p>';
  sec.insertAdjacentHTML('beforeend', `<div id="inv-list">${listHtml}</div>
    <button class="btn-sm" id="new-invite">Generuj nowy link</button>`);

  sec.querySelector('#new-invite').addEventListener('click', async () => {
    try { await api('/admin/invites', { method: 'POST', body: {} }); navigate('admin'); toast('Nowy link wygenerowany'); }
    catch (err) { toast(err.message, true); }
  });
  $$('[data-copy]', sec).forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Skopiowano link')).catch(() => toast('Nie udalo sie skopiowac', true));
  }));
  $$('[data-deact]', sec).forEach((b) => b.addEventListener('click', async () => {
    try { await api('/admin/invites/deactivate', { method: 'POST', body: { token: b.dataset.deact } }); navigate('admin'); }
    catch (err) { toast(err.message, true); }
  }));
}

async function renderPlayers(sec) {
  const data = await api('/admin/players');
  const rows = data.players.map((p) => `
    <div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--line)">
      <span>${esc(p.nick)} ${p.is_admin ? '<span class="badge open">admin</span>' : ''}</span>
      ${p.is_admin ? '' : `<button class="btn-sm btn-danger" data-del="${p.id}" data-nick="${esc(p.nick)}">Usun</button>`}
    </div>`).join('');
  sec.insertAdjacentHTML('beforeend', rows || '<p class="muted">Brak graczy.</p>');
  $$('[data-del]', sec).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Usunac gracza "${b.dataset.nick}"? Jego typy zostana skasowane.`)) return;
    try { await api('/admin/players/' + b.dataset.del, { method: 'DELETE' }); navigate('admin'); toast('Gracz usuniety'); }
    catch (err) { toast(err.message, true); }
  }));
}

// ================= START =================
(async function init() {
  if (state.token) {
    try {
      const me = await api('/me');
      state.player = me.player;
      await startApp();
      return;
    } catch { localStorage.removeItem('typer_token'); state.token = null; }
  }
  showAuth();
})();
