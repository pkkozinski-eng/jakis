// System punktacji kumulatywnej dla typera Premier League 2026/27
//
// Punkty za pojedynczy mecz sumuja sie z ponizszych skladnikow:
//   - Trafiony rezultat (1 / X / 2)  ............ 2 pkt
//   - Trafiona dokladna roznica bramek .......... +1 pkt
//   - Trafiona dokladna liczba bramek gospodarzy  +1 pkt
//   - Trafiona dokladna liczba bramek gosci ..... +1 pkt
// Maksymalnie 5 pkt za mecz (dokladny wynik = 2+1+1+1).

/** Zwraca 'H' (gospodarz), 'D' (remis) lub 'A' (gosc) dla danego wyniku. */
export function outcome(home, away) {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

/**
 * Oblicza punkty za pojedynczy mecz.
 * @param {{home:number, away:number}} prediction  typ gracza
 * @param {{home:number, away:number}} result      wynik meczu
 * @returns {{points:number, exact:boolean, correctResult:boolean, breakdown:object}}
 */
export function scoreMatch(prediction, result) {
  if (
    prediction == null ||
    result == null ||
    prediction.home == null ||
    prediction.away == null ||
    result.home == null ||
    result.away == null
  ) {
    return {
      points: 0,
      exact: false,
      correctResult: false,
      breakdown: { result: 0, difference: 0, homeGoals: 0, awayGoals: 0 },
    };
  }

  const pH = Number(prediction.home);
  const pA = Number(prediction.away);
  const rH = Number(result.home);
  const rA = Number(result.away);

  const correctResult = outcome(pH, pA) === outcome(rH, rA);
  const correctDifference = pH - pA === rH - rA;
  const correctHome = pH === rH;
  const correctAway = pA === rA;

  const breakdown = {
    result: correctResult ? 2 : 0,
    difference: correctDifference ? 1 : 0,
    homeGoals: correctHome ? 1 : 0,
    awayGoals: correctAway ? 1 : 0,
  };

  const points =
    breakdown.result + breakdown.difference + breakdown.homeGoals + breakdown.awayGoals;

  return {
    points,
    exact: pH === rH && pA === rA, // dokladny wynik = 5 pkt
    correctResult,
    breakdown,
  };
}
