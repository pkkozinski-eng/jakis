import type { HistoryItem } from "../types";

interface Props {
  items: HistoryItem[];
  onOpen: (id: number) => void;
}

export default function History({ items, onOpen }: Props) {
  return (
    <div className="rounded-2xl border border-edge bg-panel/70 p-6 shadow-xl backdrop-blur">
      <h2 className="mb-4 text-lg font-semibold">Historia analiz</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Brak zapisanych analiz.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const enter = it.verdict === "WCHODZE";
            return (
              <li key={it.id}>
                <button
                  onClick={() => onOpen(it.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-edge bg-ink/40 px-3 py-2 text-left text-sm transition hover:border-sky-500/50"
                >
                  <span>
                    <span className="font-medium">{it.pair}</span>{" "}
                    <span className="text-slate-400">{it.timeframe}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {new Date(it.created_at).toLocaleString("pl-PL")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{it.score}/10</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        enter ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {enter ? "WCHODZĘ" : "NIE"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
