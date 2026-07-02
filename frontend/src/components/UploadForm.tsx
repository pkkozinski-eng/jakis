import { useRef, useState } from "react";
import type { AppConfig } from "../types";

interface Props {
  config: AppConfig;
  loading: boolean;
  onSubmit: (image: File, pair: string, timeframe: string) => void;
}

export default function UploadForm({ config, loading, onSubmit }: Props) {
  const [pair, setPair] = useState(config.default_pairs[0] ?? "EUR/USD");
  const [customPair, setCustomPair] = useState("");
  const [timeframe, setTimeframe] = useState(config.timeframes[0] ?? "H4");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const useCustom = pair === "__custom__";
  const effectivePair = useCustom ? customPair.trim().toUpperCase() : pair;

  function pickFile(f: File | null) {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !effectivePair) return;
    onSubmit(file, effectivePair, timeframe);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-edge bg-panel/70 p-6 shadow-xl backdrop-blur">
      <h2 className="mb-4 text-lg font-semibold">Nowa analiza</h2>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-edge bg-ink/40 p-6 text-center transition hover:border-sky-500/50"
      >
        {preview ? (
          <img src={preview} alt="podgląd" className="max-h-56 rounded-lg" />
        ) : (
          <>
            <div className="text-3xl">📈</div>
            <p className="mt-2 text-sm text-slate-300">Kliknij lub przeciągnij screenshot wykresu</p>
            <p className="text-xs text-slate-500">PNG / JPG / WEBP, max 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* Para + rama */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Para walutowa</span>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2"
          >
            {config.default_pairs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="__custom__">Inna…</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Rama czasowa</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2"
          >
            {config.timeframes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {useCustom && (
        <input
          value={customPair}
          onChange={(e) => setCustomPair(e.target.value)}
          placeholder="np. AUD/USD"
          className="mt-3 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm uppercase"
        />
      )}

      {config.mock_mode && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Tryb DEMO: brak klucza ANTHROPIC_API_KEY — odczyt obrazu jest przykładowy, nie z realnego wykresu.
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !file || !effectivePair}
        className="mt-4 w-full rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-ink transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Analizuję…" : "Analizuj wykres"}
      </button>
    </form>
  );
}
