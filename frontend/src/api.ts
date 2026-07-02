import type { AnalysisResult, AppConfig, HistoryItem } from "./types";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body;
    } catch {
      /* ignore */
    }
    if (detail && typeof detail === "object" && "message" in detail) {
      const d = detail as { message: string; errors?: string[] };
      throw new Error(`${d.message}${d.errors?.length ? "\n• " + d.errors.join("\n• ") : ""}`);
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export async function getConfig(): Promise<AppConfig> {
  return handle(await fetch("/api/config"));
}

export async function analyze(
  image: File,
  pair: string,
  timeframe: string,
): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("image", image);
  form.append("pair", pair);
  form.append("timeframe", timeframe);
  return handle(await fetch("/api/analyze", { method: "POST", body: form }));
}

export async function getHistory(): Promise<{ items: HistoryItem[] }> {
  return handle(await fetch("/api/history"));
}

export async function getHistoryItem(id: number): Promise<AnalysisResult> {
  return handle(await fetch(`/api/history/${id}`));
}
