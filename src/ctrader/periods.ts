// Mapping between human-friendly timeframe names and cTrader ProtoOATrendbarPeriod
// enum values, together with each bar's duration in minutes (used to bound the
// history window requested from the server).

export interface Period {
  name: string;
  value: number;
  minutes: number;
}

export const PERIODS: Record<string, Period> = {
  M1: { name: "M1", value: 1, minutes: 1 },
  M2: { name: "M2", value: 2, minutes: 2 },
  M3: { name: "M3", value: 3, minutes: 3 },
  M4: { name: "M4", value: 4, minutes: 4 },
  M5: { name: "M5", value: 5, minutes: 5 },
  M10: { name: "M10", value: 6, minutes: 10 },
  M15: { name: "M15", value: 7, minutes: 15 },
  M30: { name: "M30", value: 8, minutes: 30 },
  H1: { name: "H1", value: 9, minutes: 60 },
  H4: { name: "H4", value: 10, minutes: 240 },
  H12: { name: "H12", value: 11, minutes: 720 },
  D1: { name: "D1", value: 12, minutes: 1440 },
  W1: { name: "W1", value: 13, minutes: 10080 },
  MN1: { name: "MN1", value: 14, minutes: 43200 },
};

export const PERIOD_NAMES = Object.keys(PERIODS);

export function resolvePeriod(input: string): Period {
  const key = input.trim().toUpperCase();
  const period = PERIODS[key];
  if (!period) {
    throw new Error(
      `Unknown timeframe "${input}". Valid timeframes: ${PERIOD_NAMES.join(", ")}.`,
    );
  }
  return period;
}
