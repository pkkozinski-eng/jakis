// Obliczanie tabel: klasyfikacja generalna oraz tabela pojedynczej kolejki.
// Punkty liczone sa "w locie" z typow + zakonczonych meczow, dzieki czemu
// zawsze sa spojne po korekcie wyniku przez administratora.

import {
  listPlayers,
  getFinishedMatches,
  getAllPredictions,
  getMatchesByRound,
  getPredictionsForMatch,
} from './db.js';
import { scoreMatch } from './scoring.js';

/**
 * Klasyfikacja generalna: suma punktow 1-38 kolejka.
 * Kryteria przy remisie: 1) punkty, 2) liczba dokladnych wynikow,
 * 3) liczba trafionych rezultatow.
 */
export function generalStandings() {
  const players = listPlayers();
  const finished = getFinishedMatches();
  const finishedById = new Map(finished.map((m) => [m.id, m]));
  const preds = getAllPredictions();

  const stats = new Map();
  for (const p of players) {
    stats.set(p.id, {
      playerId: p.id,
      nick: p.nick,
      points: 0,
      exact: 0,
      correctResults: 0,
      played: 0,
    });
  }

  for (const pr of preds) {
    const m = finishedById.get(pr.match_id);
    if (!m) continue;
    const s = stats.get(pr.player_id);
    if (!s) continue;
    const res = scoreMatch({ home: pr.home, away: pr.away }, { home: m.home_goals, away: m.away_goals });
    s.points += res.points;
    if (res.exact) s.exact += 1;
    if (res.correctResult) s.correctResults += 1;
    s.played += 1;
  }

  const rows = [...stats.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.exact - a.exact ||
      b.correctResults - a.correctResults ||
      a.nick.localeCompare(b.nick)
  );
  rows.forEach((r, i) => (r.position = i + 1));
  return rows;
}

/** Tabela pojedynczej kolejki - punkty graczy za mecze tej kolejki. */
export function roundStandings(round) {
  const players = listPlayers();
  const matches = getMatchesByRound(round);
  const finished = matches.filter((m) => m.finished);
  const finishedIds = new Set(finished.map((m) => m.id));
  const finishedById = new Map(finished.map((m) => [m.id, m]));

  const stats = new Map();
  for (const p of players) {
    stats.set(p.id, { playerId: p.id, nick: p.nick, points: 0, exact: 0, correctResults: 0, played: 0 });
  }

  for (const m of finished) {
    const preds = getPredictionsForMatch(m.id);
    for (const pr of preds) {
      const s = stats.get(pr.player_id);
      if (!s) continue;
      const res = scoreMatch({ home: pr.home, away: pr.away }, { home: m.home_goals, away: m.away_goals });
      s.points += res.points;
      if (res.exact) s.exact += 1;
      if (res.correctResult) s.correctResults += 1;
      s.played += 1;
    }
  }

  const rows = [...stats.values()].sort(
    (a, b) => b.points - a.points || b.exact - a.exact || b.correctResults - a.correctResults || a.nick.localeCompare(b.nick)
  );
  rows.forEach((r, i) => (r.position = i + 1));
  return { round, finishedMatches: finished.length, totalMatches: matches.length, rows, finishedIds: [...finishedIds] };
}
