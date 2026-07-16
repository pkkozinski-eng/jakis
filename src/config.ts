import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value.startsWith("your_")) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in (see README.md).`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

const env = optional("CTRADER_ENV", "demo").toLowerCase();
const defaultHost = env === "live" ? "live.ctraderapi.com" : "demo.ctraderapi.com";

export const config = {
  ctrader: {
    clientId: required("CTRADER_CLIENT_ID"),
    clientSecret: required("CTRADER_CLIENT_SECRET"),
    accessToken: required("CTRADER_ACCESS_TOKEN"),
    accountId: Number(required("CTRADER_ACCOUNT_ID")),
    host: optional("CTRADER_HOST", defaultHost),
    port: Number(optional("CTRADER_PORT", "5035")),
    env,
  },
  mcp: {
    host: optional("MCP_HOST", "127.0.0.1"),
    port: Number(optional("MCP_PORT", "9876")),
  },
} as const;

export function assertConfig(): void {
  if (!Number.isFinite(config.ctrader.accountId)) {
    throw new Error("CTRADER_ACCOUNT_ID must be a number (the ctidTraderAccountId).");
  }
}
