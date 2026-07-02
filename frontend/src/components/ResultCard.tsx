import type { AnalysisResult } from "../types";

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" | "warn" | "neutral" }) {
  const tones: Record<string, string> = {
    good: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    bad: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    neutral: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ScoreDial({ score, threshold }: { score: number; threshold: number }) {
  const enter = score >= threshold;
  const pct = (score / 10) * 100;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
          <path
            className="text-edge"
            stroke="currentColor"
            strokeWidth="3.5"
            fill="none"
            d="M18 2.5 a 15.5 15.5 0 1 1 0 31 a 15.5 15.5 0 1 1 0 -31"
          />
          <path
            className={enter ? "text-emerald-400" : "text-rose-400"}
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${pct}, 100`}
            d="M18 2.5 a 15.5 15.5 0 1 1 0 31 a 15.5 15.5 0 1 1 0 -31"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{score}</span>
          <span className="text-xs text-slate-400">/ 10</span>
        </div>
      </div>
      <span className="text-xs text-slate-400">próg wejścia: {threshold}</span>
    </div>
  );
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toString());

export default function ResultCard({ result }: { result: AnalysisResult }) {
  const enter = result.verdict === "WCHODZE";
  const f = result.fundamentals;
  const alignTone = f.alignment === "zgodny" ? "good" : f.alignment === "przeciwny" ? "bad" : "neutral";

  return (
    <div className="rounded-2xl border border-edge bg-panel/70 p-6 shadow-xl backdrop-blur">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{result.pair}</h2>
            <Badge tone="neutral">{result.timeframe}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="neutral">trend: {result.trend}</Badge>
            <Badge tone="neutral">formacja: {result.pattern}</Badge>
            <Badge tone="neutral">kierunek: {result.pattern_direction}</Badge>
            <Badge tone="neutral">pewność odczytu: {Math.round(result.vision_confidence * 100)}%</Badge>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <ScoreDial score={result.score} threshold={result.threshold} />
          <div className="text-center">
            <div
              className={`rounded-xl px-5 py-4 text-2xl font-extrabold ring-1 ${
                enter
                  ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                  : "bg-rose-500/15 text-rose-300 ring-rose-500/30"
              }`}
            >
              {enter ? "WCHODZĘ" : "NIE WCHODZĘ"}
            </div>
          </div>
        </div>
      </div>

      {/* Ostrzeżenia */}
      {result.warnings.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="mb-1 text-sm font-semibold text-amber-300">Ostrzeżenia</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/90">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Siatka: czynniki + SL/TP */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* Czynniki scoringu */}
        <div className="rounded-xl border border-edge bg-ink/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Czynniki scoringu (reguły w kodzie)</h3>
          <div className="space-y-3">
            {result.factors.map((factor, i) => {
              const ratio = factor.max_points ? factor.points / factor.max_points : 0;
              return (
                <div key={i} className={factor.applicable ? "" : "opacity-50"}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{factor.name}</span>
                    <span className="font-mono text-slate-300">
                      {factor.points}/{factor.max_points}
                      {!factor.applicable && " (N/D)"}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-edge">
                    <div
                      className="h-1.5 rounded-full bg-sky-400"
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{factor.rationale}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 border-t border-edge pt-2 text-xs text-slate-400">
            Suma: {result.raw_points}/{result.max_points} → wynik znormalizowany {result.score}/10
          </div>
        </div>

        {/* SL / TP / R:R */}
        <div className="space-y-6">
          <div className="rounded-xl border border-edge bg-ink/40 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">Zarządzanie pozycją</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xs text-slate-400">Wejście</div>
                <div className="font-mono text-lg">{fmt(result.sltp.entry)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Stop Loss</div>
                <div className="font-mono text-lg text-rose-300">{fmt(result.sltp.stop_loss)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Take Profit</div>
                <div className="font-mono text-lg text-emerald-300">{fmt(result.sltp.take_profit)}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-edge pt-3 text-sm">
              <span className="text-slate-400">Ryzyko/Zysk (R:R)</span>
              {result.sltp.rr !== null ? (
                <Badge tone={result.sltp.rr_ok ? "good" : "warn"}>1 : {result.sltp.rr.toFixed(2)}</Badge>
              ) : (
                <Badge tone="warn">brak celu (ryzyko)</Badge>
              )}
            </div>
          </div>

          {/* Fundamenty */}
          <div className="rounded-xl border border-edge bg-ink/40 p-4">
            <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-300">
              <span>Kontekst fundamentalny / makro</span>
              <Badge tone="neutral">{f.source === "live" ? "na żywo" : "tabela"} · {f.as_of}</Badge>
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-slate-400">Stopa {f.base_ccy}</div>
              <div className="text-right font-mono">{fmt(f.base_rate)}{f.base_rate !== null ? "%" : ""}</div>
              <div className="text-slate-400">Stopa {f.quote_ccy}</div>
              <div className="text-right font-mono">{fmt(f.quote_rate)}{f.quote_rate !== null ? "%" : ""}</div>
              <div className="text-slate-400">Różnica stóp (carry)</div>
              <div className="text-right font-mono">{fmt(f.rate_differential)}{f.rate_differential !== null ? " p.p." : ""}</div>
              <div className="text-slate-400">Zgodność z techniką</div>
              <div className="text-right"><Badge tone={alignTone}>{f.alignment}</Badge></div>
            </div>
            {f.high_impact_event_warning && (
              <p className="mt-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-200">
                ⚠ {f.high_impact_event_warning}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Uzasadnienie */}
      <div className="mt-6 rounded-xl border border-edge bg-ink/40 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Uzasadnienie</h3>
        <p className="text-sm leading-relaxed text-slate-200">{result.reasoning}</p>
      </div>

      {/* Disclaimer */}
      <p className="mt-5 rounded-lg border border-edge bg-ink/60 p-3 text-xs text-slate-400">
        {result.disclaimer}
      </p>
    </div>
  );
}
