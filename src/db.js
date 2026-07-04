// Warstwa bazy danych (SQLite przez better-sqlite3).
//
// Cala logika dostepu do bazy jest odizolowana w tym pliku. Dzieki temu
// przejscie na Postgres / Supabase (np. dla wdrozenia serverless na Vercel)
// sprowadza sie do podmiany tego modulu - reszta aplikacji korzysta tylko
// z eksportowanych funkcji.

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sciezka do pliku bazy - konfigurowalna przez ENV (wazne dla wdrozen
// z trwalym dyskiem, np. Render/Railway/Fly).
const DB_PATH = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'typer.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nick       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pin_hash   TEXT NOT NULL,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    round      INTEGER NOT NULL,
    home       TEXT NOT NULL,
    away       TEXT NOT NULL,
    kickoff    TEXT NOT NULL,
    home_goals INTEGER,
    away_goals INTEGER,
    finished   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round);

  CREATE TABLE IF NOT EXISTS predictions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home       INTEGER NOT NULL,
    away       INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (player_id, match_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id);
  CREATE INDEX IF NOT EXISTS idx_pred_player ON predictions(player_id);

  CREATE TABLE IF NOT EXISTS invites (
    token      TEXT PRIMARY KEY,
    note       TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// --- Meta (klucz-wartosc) ---
export function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// Sekret do podpisywania tokenow sesji - generowany raz i trwale zapisany,
// aby sesje przetrwaly restart serwera. Mozna nadpisac przez ENV SESSION_SECRET.
export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let secret = getMeta('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setMeta('session_secret', secret);
  }
  return secret;
}

// --- Gracze ---
export function createPlayer({ nick, pinHash, isAdmin = 0 }) {
  const info = db
    .prepare('INSERT INTO players (nick, pin_hash, is_admin) VALUES (?, ?, ?)')
    .run(nick, pinHash, isAdmin ? 1 : 0);
  return getPlayerById(info.lastInsertRowid);
}
export function getPlayerById(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}
export function getPlayerByNick(nick) {
  return db.prepare('SELECT * FROM players WHERE nick = ? COLLATE NOCASE').get(nick);
}
export function listPlayers() {
  return db.prepare('SELECT id, nick, is_admin, created_at FROM players ORDER BY nick COLLATE NOCASE').all();
}
export function deletePlayer(id) {
  return db.prepare('DELETE FROM players WHERE id = ? AND is_admin = 0').run(id);
}
export function updatePlayerPin(id, pinHash) {
  return db.prepare('UPDATE players SET pin_hash = ? WHERE id = ?').run(pinHash, id);
}

// --- Mecze ---
export function countMatches() {
  return db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
}
export function insertMatchesBulk(matches) {
  const stmt = db.prepare(
    'INSERT INTO matches (round, home, away, kickoff) VALUES (@round, @home, @away, @kickoff)'
  );
  const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(r)));
  tx(matches);
}
export function getMatch(id) {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
}
export function listRoundsSummary() {
  return db
    .prepare(
      `SELECT round,
              COUNT(*)                       AS matches,
              SUM(finished)                  AS finished,
              MIN(kickoff)                   AS first_kickoff,
              MAX(kickoff)                   AS last_kickoff
         FROM matches
        GROUP BY round
        ORDER BY round`
    )
    .all();
}
export function getMatchesByRound(round) {
  return db.prepare('SELECT * FROM matches WHERE round = ? ORDER BY kickoff, id').all(round);
}
export function getFinishedMatches() {
  return db.prepare('SELECT * FROM matches WHERE finished = 1').all();
}
export function setMatchResult(id, homeGoals, awayGoals) {
  return db
    .prepare('UPDATE matches SET home_goals = ?, away_goals = ?, finished = 1 WHERE id = ?')
    .run(homeGoals, awayGoals, id);
}
export function clearMatchResult(id) {
  return db
    .prepare('UPDATE matches SET home_goals = NULL, away_goals = NULL, finished = 0 WHERE id = ?')
    .run(id);
}
export function setMatchKickoff(id, kickoff) {
  return db.prepare('UPDATE matches SET kickoff = ? WHERE id = ?').run(kickoff, id);
}

// --- Typy ---
export function upsertPrediction(playerId, matchId, home, away) {
  return db
    .prepare(
      `INSERT INTO predictions (player_id, match_id, home, away, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(player_id, match_id)
       DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = datetime('now')`
    )
    .run(playerId, matchId, home, away);
}
export function getPredictionsForPlayer(playerId) {
  return db.prepare('SELECT * FROM predictions WHERE player_id = ?').all(playerId);
}
export function getPredictionsForMatch(matchId) {
  return db
    .prepare(
      `SELECT p.*, pl.nick FROM predictions p
         JOIN players pl ON pl.id = p.player_id
        WHERE p.match_id = ?`
    )
    .all(matchId);
}
export function getAllPredictions() {
  return db.prepare('SELECT * FROM predictions').all();
}

// --- Zaproszenia ---
export function createInvite(token, note = null) {
  db.prepare('INSERT INTO invites (token, note) VALUES (?, ?)').run(token, note);
  return db.prepare('SELECT * FROM invites WHERE token = ?').get(token);
}
export function getInvite(token) {
  return db.prepare('SELECT * FROM invites WHERE token = ?').get(token);
}
export function listInvites() {
  return db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all();
}
export function deactivateInvite(token) {
  return db.prepare('UPDATE invites SET active = 0 WHERE token = ?').run(token);
}

export default db;
