import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ctrader, type Candle } from "./ctrader/client.js";
import { PERIOD_NAMES } from "./ctrader/periods.js";

const SERVER_INFO = { name: "ctrader", version: "1.0.0" };

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

/** Lightweight stats to help Claude reason about the series without re-reading every bar. */
function summarize(candles: Candle[]) {
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  const first = candles[0];
  const last = candles[candles.length - 1];
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const change = last.close - first.open;
  const sma = (n: number) =>
    closes.length >= n
      ? Number(
          (closes.slice(-n).reduce((a, b) => a + b, 0) / n).toFixed(6),
        )
      : null;
  return {
    bars: candles.length,
    from: first.time,
    to: last.time,
    open: first.open,
    close: last.close,
    change: Number(change.toFixed(6)),
    changePercent: Number(((change / first.open) * 100).toFixed(4)),
    high: Math.max(...highs),
    low: Math.min(...lows),
    sma20: sma(20),
    sma50: sma(50),
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "ctrader_list_symbols",
    {
      title: "List cTrader symbols",
      description:
        "List tradable symbols available on the connected cTrader account. " +
        "Optionally filter by a substring (e.g. 'EUR', 'US30', 'BTC').",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe("Case-insensitive substring to filter symbol names."),
      },
    },
    async ({ filter }) => {
      try {
        let symbols = await ctrader.getSymbols();
        if (filter) {
          const f = filter.toUpperCase();
          symbols = symbols.filter((s) => s.symbolName.toUpperCase().includes(f));
        }
        return textResult({
          count: symbols.length,
          symbols: symbols.map((s) => ({ id: s.symbolId, name: s.symbolName })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ctrader_get_candles",
    {
      title: "Get OHLC candles",
      description:
        "Fetch recent OHLC (candlestick) data for a symbol and timeframe, including " +
        "the currently forming bar, for live chart analysis. Returns the candles plus " +
        "a summary (change, high/low, SMA20/50). Timeframes: " +
        PERIOD_NAMES.join(", ") +
        ".",
      inputSchema: {
        symbol: z.string().describe("Symbol name or id, e.g. 'EURUSD', 'XAUUSD', 'US30'."),
        timeframe: z
          .string()
          .describe(`Timeframe, one of: ${PERIOD_NAMES.join(", ")}.`),
        count: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(200)
          .describe("Number of most recent candles to return (max 2000)."),
      },
    },
    async ({ symbol, timeframe, count }) => {
      try {
        const result = await ctrader.getTrendbars(symbol, timeframe, count ?? 200);
        return textResult({
          symbol: result.symbol,
          timeframe: result.timeframe,
          summary: summarize(result.candles),
          candles: result.candles,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ctrader_get_quote",
    {
      title: "Get live quote",
      description:
        "Get the current live bid/ask/spread for a symbol (streamed from cTrader). " +
        "Use this for the latest price alongside candle data.",
      inputSchema: {
        symbol: z.string().describe("Symbol name or id, e.g. 'EURUSD'."),
      },
    },
    async ({ symbol }) => {
      try {
        const quote = await ctrader.getQuote(symbol);
        return textResult(quote);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
