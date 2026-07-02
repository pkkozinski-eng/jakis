import { useEffect, useState } from "react";
import { analyze, getConfig, getHistory, getHistoryItem } from "./api";
import type { AnalysisResult, AppConfig, HistoryItem } from "./types";
import UploadForm from "./components/UploadForm";
import ResultCard from "./components/ResultCard";
import History from "./components/History";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshHistory() {
    try {
      const { items } = await getHistory();
      setHistory(items);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    getConfig().then(setConfig).catch((e) => setError(String(e)));
    refreshHistory();
  }, []);

  async function handleSubmit(image: File, pair: string, timeframe: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await analyze(image, pair, timeframe);
      setResult(res);
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function openHistory(id: number) {
    try {
      setResult(await getHistoryItem(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Forex Signal Analyzer
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Analiza price action w stylu Nial Fullera · AI odczyt obrazu + regułowy scoring + kontekst makro
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          {config ? (
            <UploadForm config={config} loading={loading} onSubmit={handleSubmit} />
          ) : (
            <div className="rounded-2xl border border-edge bg-panel/70 p-6 text-sm text-slate-400">
              Ładowanie konfiguracji…
            </div>
          )}
          <History items={history} onOpen={openHistory} />
        </div>

        <div className="space-y-6">
          {error && (
            <div className="whitespace-pre-line rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              <div className="mb-1 font-semibold">Analiza nie powiodła się</div>
              {error}
            </div>
          )}
          {result ? (
            <ResultCard result={result} />
          ) : (
            !error && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-edge bg-panel/40 p-6 text-center text-slate-400">
                Wgraj screenshot wykresu i uruchom analizę — tutaj pojawi się karta wyniku.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
