import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { config } from "../config.js";
import { resolvePeriod } from "./periods.js";

const PRICE_SCALE = 100000; // cTrader Open API scales all prices by 1e5

/** Coerce a protobuf numeric field (number | string | Long-like) into a JS number. */
function toNum(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object") {
    const anyVal = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof anyVal.toNumber === "function") return anyVal.toNumber();
    // Fallback for {low, high} Long representation.
    if (typeof anyVal.low === "number" && typeof anyVal.high === "number") {
      return anyVal.high * 4294967296 + (anyVal.low >>> 0);
    }
  }
  return Number(value);
}

export interface Candle {
  time: string; // ISO 8601 (UTC)
  timestamp: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  time: string;
  timestamp: number;
}

export interface SymbolInfo {
  symbolId: number;
  symbolName: string;
  enabled: boolean;
}

interface SpotState {
  bid?: number;
  ask?: number;
  timestamp: number;
}

export class CTraderClient {
  private connection: CTraderConnection;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  private symbolsByName = new Map<string, SymbolInfo>();
  private symbolsById = new Map<number, SymbolInfo>();
  private digitsById = new Map<number, number>();

  private spotState = new Map<number, SpotState>();
  private subscribed = new Set<number>();

  constructor() {
    this.connection = this.newConnection();
  }

  private newConnection(): CTraderConnection {
    const conn = new CTraderConnection({
      host: config.ctrader.host,
      port: config.ctrader.port,
    });
    // Prevent an unhandled 'error' event from crashing the process on socket drops;
    // reconnection is driven by the 'close' handler set up in doConnect().
    conn.on("error", (err: unknown) => {
      console.error("[ctrader] connection error:", err instanceof Error ? err.message : err);
    });
    conn.on("ProtoOASpotEvent", (event: any) => this.onSpot(event));
    return conn;
  }

  private onSpot(event: any): void {
    const symbolId = Number(event.symbolId);
    if (!Number.isFinite(symbolId)) return;
    const prev = this.spotState.get(symbolId) ?? { timestamp: Date.now() };
    if (event.bid != null) prev.bid = toNum(event.bid) / PRICE_SCALE;
    if (event.ask != null) prev.ask = toNum(event.ask) / PRICE_SCALE;
    prev.timestamp = Date.now();
    this.spotState.set(symbolId, prev);
  }

  /** Establish and authenticate the connection (idempotent). */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private async doConnect(): Promise<void> {
    // Always start from a fresh connection object so retries use a clean socket.
    this.connection = this.newConnection();
    await this.withTimeout(this.connection.open(), 15_000, "cTrader connect");

    await this.connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: config.ctrader.clientId,
      clientSecret: config.ctrader.clientSecret,
    });

    await this.connection.sendCommand("ProtoOAAccountAuthReq", {
      ctidTraderAccountId: config.ctrader.accountId,
      accessToken: config.ctrader.accessToken,
    });

    this.connected = true;

    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      try {
        this.connection.sendHeartbeat();
      } catch {
        /* ignore heartbeat errors; reconnect logic handles drops */
      }
    }, 20_000);

    // Detect drops and transparently reconnect + re-subscribe.
    this.connection.on("close", () => this.handleDisconnect());

    await this.loadSymbols();
  }

  private async handleDisconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    const wasSubscribed = [...this.subscribed];
    this.subscribed.clear();

    for (let attempt = 0; attempt < 6; attempt++) {
      const delay = Math.min(30_000, 2000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.doConnect();
        for (const symbolId of wasSubscribed) await this.subscribe(symbolId);
        console.error("[ctrader] reconnected");
        return;
      } catch (err) {
        console.error(`[ctrader] reconnect attempt ${attempt + 1} failed:`, err);
      }
    }
    console.error("[ctrader] giving up reconnect; next request will retry");
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  private async loadSymbols(): Promise<void> {
    const res: any = await this.connection.sendCommand("ProtoOASymbolsListReq", {
      ctidTraderAccountId: config.ctrader.accountId,
      includeArchivedSymbols: false,
    });
    this.symbolsByName.clear();
    this.symbolsById.clear();
    for (const s of res.symbol ?? []) {
      const info: SymbolInfo = {
        symbolId: Number(s.symbolId),
        symbolName: String(s.symbolName),
        enabled: Boolean(s.enabled),
      };
      this.symbolsByName.set(info.symbolName.toUpperCase(), info);
      this.symbolsById.set(info.symbolId, info);
    }
  }

  async getSymbols(): Promise<SymbolInfo[]> {
    await this.ensureConnected();
    if (this.symbolsByName.size === 0) await this.loadSymbols();
    return [...this.symbolsByName.values()].sort((a, b) =>
      a.symbolName.localeCompare(b.symbolName),
    );
  }

  async resolveSymbol(nameOrId: string | number): Promise<SymbolInfo> {
    await this.ensureConnected();
    if (this.symbolsByName.size === 0) await this.loadSymbols();

    if (typeof nameOrId === "number" || /^\d+$/.test(String(nameOrId))) {
      const info = this.symbolsById.get(Number(nameOrId));
      if (info) return info;
    }
    const key = String(nameOrId).toUpperCase();
    const exact = this.symbolsByName.get(key);
    if (exact) return exact;

    // Try normalized match (e.g. "EUR/USD" -> "EURUSD").
    const normalized = key.replace(/[^A-Z0-9]/g, "");
    for (const info of this.symbolsByName.values()) {
      if (info.symbolName.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized) {
        return info;
      }
    }
    throw new Error(
      `Symbol "${nameOrId}" not found. Use the ctrader_list_symbols tool to see available symbols.`,
    );
  }

  private async getDigits(symbolId: number): Promise<number> {
    const cached = this.digitsById.get(symbolId);
    if (cached != null) return cached;
    const res: any = await this.connection.sendCommand("ProtoOASymbolByIdReq", {
      ctidTraderAccountId: config.ctrader.accountId,
      symbolId: [symbolId],
    });
    const detail = res.symbol?.[0];
    const digits = detail ? Number(detail.digits) : 5;
    this.digitsById.set(symbolId, digits);
    return digits;
  }

  async getTrendbars(
    symbolNameOrId: string | number,
    periodName: string,
    count: number,
  ): Promise<{ symbol: string; timeframe: string; candles: Candle[] }> {
    await this.ensureConnected();
    const symbol = await this.resolveSymbol(symbolNameOrId);
    const period = resolvePeriod(periodName);
    const bars = Math.max(1, Math.min(count, 2000));

    const now = Date.now();
    const from = now - bars * period.minutes * 60_000;

    const res: any = await this.connection.sendCommand("ProtoOAGetTrendbarsReq", {
      ctidTraderAccountId: config.ctrader.accountId,
      symbolId: symbol.symbolId,
      period: period.value,
      fromTimestamp: from,
      toTimestamp: now,
      count: bars,
    });

    const candles: Candle[] = (res.trendbar ?? []).map((bar: any) => {
      const low = toNum(bar.low);
      const open = low + toNum(bar.deltaOpen);
      const high = low + toNum(bar.deltaHigh);
      const close = low + toNum(bar.deltaClose);
      const timestamp = toNum(bar.utcTimestampInMinutes) * 60_000;
      return {
        time: new Date(timestamp).toISOString(),
        timestamp,
        open: open / PRICE_SCALE,
        high: high / PRICE_SCALE,
        low: low / PRICE_SCALE,
        close: close / PRICE_SCALE,
        volume: toNum(bar.volume),
      };
    });

    candles.sort((a, b) => a.timestamp - b.timestamp);
    return { symbol: symbol.symbolName, timeframe: period.name, candles };
  }

  private async subscribe(symbolId: number): Promise<void> {
    if (this.subscribed.has(symbolId)) return;
    await this.connection.sendCommand("ProtoOASubscribeSpotsReq", {
      ctidTraderAccountId: config.ctrader.accountId,
      symbolId: [symbolId],
    });
    this.subscribed.add(symbolId);
  }

  async getQuote(symbolNameOrId: string | number): Promise<Quote> {
    await this.ensureConnected();
    const symbol = await this.resolveSymbol(symbolNameOrId);
    const digits = await this.getDigits(symbol.symbolId);
    await this.subscribe(symbol.symbolId);

    // Wait briefly for a live tick to arrive after subscribing.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const state = this.spotState.get(symbol.symbolId);
      if (state && state.bid != null && state.ask != null) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const state = this.spotState.get(symbol.symbolId);
    if (!state || state.bid == null || state.ask == null) {
      throw new Error(
        `No live quote received for ${symbol.symbolName} within 5s. ` +
          `The market may be closed for this symbol.`,
      );
    }

    const round = (n: number) => Number(n.toFixed(digits));
    return {
      symbol: symbol.symbolName,
      bid: round(state.bid),
      ask: round(state.ask),
      spread: round(state.ask - state.bid),
      time: new Date(state.timestamp).toISOString(),
      timestamp: state.timestamp,
    };
  }
}

export const ctrader = new CTraderClient();
