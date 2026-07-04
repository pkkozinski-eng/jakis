// Generator terminarza Premier League 2026/27.
//
// UWAGA: dokladny terminarz PL 2026/27 nie jest jeszcze oficjalnie znany.
// Ponizej generujemy poprawny, kompletny terminarz dwurundowy (kazdy z kazdym
// u siebie i na wyjezdzie) = 20 druzyn * 19 kolejek * 2 = 38 kolejek, 380 meczow.
// Nazwy druzyn oraz daty/godziny meczow moga byc dowolnie edytowane w panelu
// administratora (przelozone mecze, korekta terminarza).

// Domyslna lista 20 klubow Premier League (edytowalna).
export const DEFAULT_TEAMS = [
  'Arsenal',
  'Aston Villa',
  'Bournemouth',
  'Brentford',
  'Brighton',
  'Burnley',
  'Chelsea',
  'Crystal Palace',
  'Everton',
  'Fulham',
  'Leeds United',
  'Liverpool',
  'Manchester City',
  'Manchester United',
  'Newcastle United',
  'Nottingham Forest',
  'Sunderland',
  'Tottenham Hotspur',
  'West Ham United',
  'Wolverhampton',
];

/**
 * Metoda "berlinska" (circle method) - generuje pojedyncza runde (kazdy z kazdym).
 * Zwraca tablice kolejek; kazda kolejka to tablica par [homeIdx, awayIdx].
 */
function singleRoundRobin(teams) {
  const n = teams.length;
  const idx = [...Array(n).keys()];
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      let home = idx[i];
      let away = idx[n - 1 - i];
      // Zamiana gospodarza/goscia naprzemiennie, by rozlozyc mecze u siebie.
      if (r % 2 === 1) [home, away] = [away, home];
      pairs.push([home, away]);
    }
    rounds.push(pairs);
    // Rotacja: pierwszy element stoi, reszta obraca sie.
    idx.splice(1, 0, idx.pop());
  }
  return rounds;
}

/**
 * Pelny terminarz dwurundowy (380 meczow dla 20 druzyn).
 * @param {string[]} teams
 * @returns {Array<{round:number, home:string, away:string}>}
 */
export function generateSchedule(teams = DEFAULT_TEAMS) {
  const first = singleRoundRobin(teams);
  const matches = [];

  first.forEach((pairs, r) => {
    pairs.forEach(([h, a]) => {
      matches.push({ round: r + 1, home: teams[h], away: teams[a] });
    });
  });
  // Runda rewanzowa - odwrocenie gospodarza i goscia.
  first.forEach((pairs, r) => {
    pairs.forEach(([h, a]) => {
      matches.push({ round: r + 1 + first.length, home: teams[a], away: teams[h] });
    });
  });

  return matches;
}

/**
 * Przypisuje przykladowe daty i godziny meczom (edytowalne w panelu admina).
 * Sezon startuje umownie w polowie sierpnia 2026, kolejki co tydzien.
 * Mecze w kolejce rozkladane sob/nd/pon w typowych godzinach PL.
 */
export function assignKickoffs(matches, seasonStartISO = '2026-08-15T14:00:00.000Z') {
  const start = new Date(seasonStartISO);
  // Sloty w obrebie kolejki (dzien wzgledem soboty, godzina lokalna UK ~ UTC latem +1).
  // Przechowujemy wszystko w UTC (ISO). Godziny podane orientacyjnie.
  const slots = [
    { day: 0, hour: 11, min: 30 }, // sobota wczesny
    { day: 0, hour: 14, min: 0 },  // sobota
    { day: 0, hour: 14, min: 0 },
    { day: 0, hour: 16, min: 30 }, // sobota wieczor
    { day: 1, hour: 13, min: 0 },  // niedziela
    { day: 1, hour: 13, min: 0 },
    { day: 1, hour: 15, min: 30 }, // niedziela
    { day: 1, hour: 15, min: 30 },
    { day: 1, hour: 15, min: 30 },
    { day: 2, hour: 19, min: 0 },  // poniedzialek
  ];

  const byRound = new Map();
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  }

  for (const [round, list] of byRound) {
    // Sobota danej kolejki: start sezonu + (round-1) tygodni.
    const roundSaturday = new Date(start.getTime());
    roundSaturday.setUTCDate(roundSaturday.getUTCDate() + (round - 1) * 7);
    list.forEach((m, i) => {
      const slot = slots[i % slots.length];
      const d = new Date(roundSaturday.getTime());
      d.setUTCDate(d.getUTCDate() + slot.day);
      d.setUTCHours(slot.hour, slot.min, 0, 0);
      m.kickoff = d.toISOString();
    });
  }

  return matches;
}
