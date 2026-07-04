// Serwer aplikacji typerskiej Premier League 2026/27.
// Express + SQLite. Serwuje API oraz statyczny frontend z katalogu /public.

import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import {
  getPlayerByNick,
  createPlayer,
  listPlayers,
  deletePlayer,
  updatePlayerPin,
  getPlayerById,
  listRoundsSummary,
  getMatchesByRound,
  getMatch,
  setMatchResult,
  clearMatchResult,
  setMatchKickoff,
  upsertPrediction,
  getPredictionsForPlayer,
  getPredictionsForMatch,
  getInvite,
  createInvite,
  listInvites,
  deactivateInvite,
} from './db.js';
import { scoreMatch } from './scoring.js';
import { createToken, attachPlayer, requireAuth, requireAdmin } from './auth.js';
import { generalStandings, roundStandings } from './standings.js';
import { runSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(attachPlayer);

const now = () => Date.now();
const isLocked = (match) => new Date(match.kickoff).getTime() <= now();

// Inicjalizacja danych przy starcie (idempotentnie).
const seedResult = runSeed();

// ---------- Walidacja ----------
function validScore(v) {
  return Number.isInteger(v) && v >= 0 && v <= 99;
}
function publicPlayer(p) {
  return { id: p.id, nick: p.nick, isAdmin: !!p.is_admin };
}

// ================= AUTH / DOLACZANIE =================

// Rejestracja przez link zaproszenia (nick + PIN).
app.post('/api/join', (req, res) => {
  const { nick, pin, invite } = req.body || {};
  if (!nick || typeof nick !== 'string' || nick.trim().length < 2 || nick.trim().length > 24) {
    return res.status(400).json({ error: 'Nick musi miec 2-24 znaki' });
  }
  if (!pin || !/^\d{4,8}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN musi miec 4-8 cyfr' });
  }
  const inv = getInvite(invite);
  if (!inv || !inv.active) {
    return res.status(403).json({ error: 'Nieprawidlowy lub nieaktywny link zaproszenia' });
  }
  if (getPlayerByNick(nick.trim())) {
    return res.status(409).json({ error: 'Ten nick jest juz zajety. Zaloguj sie lub wybierz inny.' });
  }
  const pinHash = bcrypt.hashSync(String(pin), 10);
  const player = createPlayer({ nick: nick.trim(), pinHash });
  res.json({ token: createToken(player.id), player: publicPlayer(player) });
});

// Logowanie (powrot na konto).
app.post('/api/login', (req, res) => {
  const { nick, pin } = req.body || {};
  const player = nick ? getPlayerByNick(String(nick).trim()) : null;
  if (!player || !bcrypt.compareSync(String(pin || ''), player.pin_hash)) {
    return res.status(401).json({ error: 'Bledny nick lub PIN' });
  }
  res.json({ token: createToken(player.id), player: publicPlayer(player) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ player: publicPlayer(req.player) });
});

// Zmiana wlasnego PIN-u.
app.post('/api/me/pin', requireAuth, (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!bcrypt.compareSync(String(currentPin || ''), req.player.pin_hash)) {
    return res.status(401).json({ error: 'Aktualny PIN jest bledny' });
  }
  if (!/^\d{4,8}$/.test(String(newPin || ''))) {
    return res.status(400).json({ error: 'Nowy PIN musi miec 4-8 cyfr' });
  }
  updatePlayerPin(req.player.id, bcrypt.hashSync(String(newPin), 10));
  res.json({ ok: true });
});

// ================= KOLEJKI / MECZE / TYPY =================

// Lista kolejek z podsumowaniem (do nawigacji).
app.get('/api/rounds', (req, res) => {
  const rounds = listRoundsSummary().map((r) => ({
    round: r.round,
    matches: r.matches,
    finished: r.finished,
    firstKickoff: r.first_kickoff,
    lastKickoff: r.last_kickoff,
    started: new Date(r.first_kickoff).getTime() <= now(),
    complete: r.finished === r.matches,
  }));
  res.json({ rounds });
});

// Ustala "aktualna" kolejke: pierwsza nierozegrana do konca, inaczej ostatnia.
app.get('/api/rounds/current', (req, res) => {
  const rounds = listRoundsSummary();
  let current = rounds.find((r) => r.finished < r.matches);
  if (!current) current = rounds[rounds.length - 1];
  res.json({ round: current ? current.round : 1 });
});

// Szczegoly kolejki: mecze, moj typ, oraz typy innych (jesli mecz sie rozpoczal).
app.get('/api/rounds/:round/matches', (req, res) => {
  const round = Number(req.params.round);
  const matches = getMatchesByRound(round);
  if (matches.length === 0) return res.status(404).json({ error: 'Brak takiej kolejki' });

  const myPreds = req.player
    ? new Map(getPredictionsForPlayer(req.player.id).map((p) => [p.match_id, p]))
    : new Map();

  const out = matches.map((m) => {
    const locked = isLocked(m);
    const mine = myPreds.get(m.id);
    const result = m.finished ? { home: m.home_goals, away: m.away_goals } : null;

    // Typy innych graczy widoczne dopiero po pierwszym gwizdku.
    let others = [];
    if (locked) {
      others = getPredictionsForMatch(m.id).map((p) => {
        const scored = result ? scoreMatch({ home: p.home, away: p.away }, result) : null;
        return {
          nick: p.nick,
          home: p.home,
          away: p.away,
          points: scored ? scored.points : null,
          exact: scored ? scored.exact : null,
        };
      });
      others.sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.nick.localeCompare(b.nick));
    }

    const myScored = mine && result ? scoreMatch({ home: mine.home, away: mine.away }, result) : null;

    return {
      id: m.id,
      round: m.round,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff,
      locked,
      finished: !!m.finished,
      result,
      myPrediction: mine ? { home: mine.home, away: mine.away } : null,
      myPoints: myScored ? myScored.points : null,
      others,
    };
  });

  res.json({ round, matches: out });
});

// Zapis/edycja typu (tylko przed pierwszym gwizdkiem).
app.post('/api/predictions', requireAuth, (req, res) => {
  const { matchId, home, away } = req.body || {};
  const match = getMatch(Number(matchId));
  if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu' });
  if (isLocked(match)) {
    return res.status(423).json({ error: 'Mecz juz sie rozpoczal - typ zablokowany' });
  }
  const h = Number(home);
  const a = Number(away);
  if (!validScore(h) || !validScore(a)) {
    return res.status(400).json({ error: 'Wynik musi byc liczba calkowita 0-99' });
  }
  upsertPrediction(req.player.id, match.id, h, a);
  res.json({ ok: true, prediction: { matchId: match.id, home: h, away: a } });
});

// Masowy zapis typow dla kolejki (wygodne "Zapisz wszystkie").
app.post('/api/predictions/bulk', requireAuth, (req, res) => {
  const items = Array.isArray(req.body?.predictions) ? req.body.predictions : [];
  const saved = [];
  const skipped = [];
  for (const it of items) {
    const match = getMatch(Number(it.matchId));
    if (!match) { skipped.push({ matchId: it.matchId, reason: 'brak meczu' }); continue; }
    if (isLocked(match)) { skipped.push({ matchId: it.matchId, reason: 'zablokowany' }); continue; }
    const h = Number(it.home), a = Number(it.away);
    if (!validScore(h) || !validScore(a)) { skipped.push({ matchId: it.matchId, reason: 'bledny wynik' }); continue; }
    upsertPrediction(req.player.id, match.id, h, a);
    saved.push(match.id);
  }
  res.json({ ok: true, saved, skipped });
});

// ================= TABELE =================

app.get('/api/standings', (req, res) => {
  res.json({ standings: generalStandings() });
});

app.get('/api/rounds/:round/table', (req, res) => {
  res.json(roundStandings(Number(req.params.round)));
});

// Terminarz calego sezonu (lekki widok).
app.get('/api/schedule', (req, res) => {
  const rounds = listRoundsSummary().map((r) => r.round);
  const schedule = rounds.map((round) => ({
    round,
    matches: getMatchesByRound(round).map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff,
      finished: !!m.finished,
      result: m.finished ? { home: m.home_goals, away: m.away_goals } : null,
    })),
  }));
  res.json({ schedule });
});

// ================= PANEL ADMINISTRATORA =================

// Wprowadzenie/korekta wyniku meczu.
app.post('/api/admin/results', requireAdmin, (req, res) => {
  const { matchId, home, away } = req.body || {};
  const match = getMatch(Number(matchId));
  if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu' });
  const h = Number(home), a = Number(away);
  if (!validScore(h) || !validScore(a)) {
    return res.status(400).json({ error: 'Wynik musi byc liczba calkowita 0-99' });
  }
  setMatchResult(match.id, h, a);
  res.json({ ok: true });
});

// Cofniecie wyniku (mecz znow nierozegrany).
app.post('/api/admin/results/clear', requireAdmin, (req, res) => {
  const match = getMatch(Number(req.body?.matchId));
  if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu' });
  clearMatchResult(match.id);
  res.json({ ok: true });
});

// Przelozenie meczu (zmiana daty/godziny).
app.post('/api/admin/reschedule', requireAdmin, (req, res) => {
  const { matchId, kickoff } = req.body || {};
  const match = getMatch(Number(matchId));
  if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu' });
  const d = new Date(kickoff);
  if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Bledna data' });
  setMatchKickoff(match.id, d.toISOString());
  res.json({ ok: true, kickoff: d.toISOString() });
});

// Lista graczy (admin).
app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json({ players: listPlayers() });
});

// Usuniecie gracza.
app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const p = getPlayerById(id);
  if (!p) return res.status(404).json({ error: 'Nie ma takiego gracza' });
  if (p.is_admin) return res.status(400).json({ error: 'Nie mozna usunac administratora' });
  deletePlayer(id);
  res.json({ ok: true });
});

// Zaproszenia.
app.get('/api/admin/invites', requireAdmin, (req, res) => {
  res.json({ invites: listInvites() });
});
app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const token = crypto.randomBytes(9).toString('base64url');
  const inv = createInvite(token, req.body?.note || null);
  res.json({ invite: inv });
});
app.post('/api/admin/invites/deactivate', requireAdmin, (req, res) => {
  deactivateInvite(req.body?.token);
  res.json({ ok: true });
});

// Automatyczne pobranie wynikow z football-data.org (opcjonalne).
// Wymaga zmiennej srodowiskowej FOOTBALL_DATA_TOKEN oraz zmapowania nazw druzyn.
app.post('/api/admin/fetch-results', requireAdmin, async (req, res) => {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return res.status(400).json({
      error:
        'Brak FOOTBALL_DATA_TOKEN. Ustaw darmowy klucz z football-data.org w zmiennych srodowiskowych, aby wlaczyc automatyczne pobieranie.',
    });
  }
  try {
    const matchday = Number(req.body?.round) || undefined;
    const url = new URL('https://api.football-data.org/v4/competitions/PL/matches');
    if (matchday) url.searchParams.set('matchday', String(matchday));
    const r = await fetch(url, { headers: { 'X-Auth-Token': token } });
    if (!r.ok) return res.status(502).json({ error: `API zwrocilo status ${r.status}` });
    const data = await r.json();
    // Mapowanie: dopasowujemy po nazwach druzyn (uproszczone). W praktyce nalezy
    // dostosowac mapowanie nazw z API do nazw w bazie.
    let updated = 0;
    for (const apiMatch of data.matches || []) {
      if (apiMatch.status !== 'FINISHED') continue;
      // Pozostawione jako punkt zaczepienia - patrz README (sekcja API).
      updated += 0;
    }
    res.json({ ok: true, note: 'Podglad pobrania. Uzupelnij mapowanie nazw druzyn w server.js (fetch-results).', fetched: (data.matches || []).length, updated });
  } catch (e) {
    res.status(500).json({ error: 'Blad pobierania: ' + e.message });
  }
});

// Reguly punktacji (do wyswietlenia w UI).
app.get('/api/rules', (req, res) => {
  res.json({
    rules: [
      { label: 'Trafiony rezultat (1 / X / 2)', points: 2 },
      { label: 'Trafiona dokladna roznica bramek', points: 1 },
      { label: 'Trafiona liczba bramek gospodarzy', points: 1 },
      { label: 'Trafiona liczba bramek gosci', points: 1 },
    ],
    max: 5,
  });
});

// ---------- Frontend (statyczny) ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Typer Premier League 2026/27 dziala na  http://localhost:${PORT}\n`);
  if (seedResult.admin.created) {
    console.log(`  >> Administrator: nick="${seedResult.admin.nick}"  PIN=${seedResult.admin.pin}`);
    console.log('     (ustaw wlasny przez ADMIN_NICK / ADMIN_PIN w ENV)');
  }
  console.log(`  >> Link zaproszenia (token): ${seedResult.invite.token}`);
  console.log(`     Udostepnij: http://localhost:${PORT}/?invite=${seedResult.invite.token}\n`);
});

export default app;
