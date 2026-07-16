/**
 * Interactive OAuth helper for cTrader Open API.
 *
 * Usage:
 *   1. Set CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET in your .env
 *   2. In your app settings at https://openapi.ctrader.com/, add the redirect URI
 *      printed below (default http://localhost:5033/).
 *   3. Run: npm run oauth
 *   4. Open the printed URL, authorize, and the token + account ids are printed here.
 */
import "dotenv/config";
import http from "node:http";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

const AUTH_BASE = "https://openapi.ctrader.com/apps/auth";
const TOKEN_BASE = "https://openapi.ctrader.com/apps/token";

function env(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("your_")) {
    console.error(`Missing ${name}. Set it in .env before running the OAuth helper.`);
    process.exit(1);
  }
  return v;
}

const clientId = env("CTRADER_CLIENT_ID");
const clientSecret = env("CTRADER_CLIENT_SECRET");
const scope = process.env.OAUTH_SCOPE || "trading";
const port = Number(process.env.OAUTH_REDIRECT_PORT || "5033");
const redirectUri = `http://localhost:${port}/`;

async function exchangeCode(code: string): Promise<any> {
  const url = new URL(TOKEN_BASE);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  const res = await fetch(url, { method: "POST" });
  const body = await res.json();
  return body;
}

function pick(obj: any, ...keys: string[]): any {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return undefined;
}

async function main(): Promise<void> {
  const authUrl = new URL(AUTH_BASE);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);

  console.log("\n=== cTrader OAuth helper ===\n");
  console.log(`Redirect URI (must be registered in your app): ${redirectUri}\n`);
  console.log("1) Open this URL in your browser and authorize:\n");
  console.log(`   ${authUrl.toString()}\n`);
  console.log("2) Waiting for the redirect back to this machine...\n");

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", redirectUri);
    const code = reqUrl.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Waiting for OAuth code...");
      return;
    }

    try {
      const token = await exchangeCode(code);
      const accessToken = pick(token, "accessToken", "access_token");
      const refreshToken = pick(token, "refreshToken", "refresh_token");
      const expiresIn = pick(token, "expiresIn", "expires_in");

      if (!accessToken) {
        throw new Error(`Token exchange failed: ${JSON.stringify(token)}`);
      }

      let accounts: any[] = [];
      try {
        accounts = await CTraderConnection.getAccessTokenAccounts(accessToken);
      } catch (e) {
        console.error("Could not fetch accounts automatically:", e);
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<h2>cTrader authorization complete.</h2>" +
          "<p>You can close this tab and return to the terminal.</p>",
      );

      console.log("=== SUCCESS ===\n");
      console.log("Add these to your .env file:\n");
      console.log(`CTRADER_ACCESS_TOKEN=${accessToken}`);
      if (refreshToken) console.log(`# refresh token (store safely): ${refreshToken}`);
      if (expiresIn) console.log(`# access token expires in ~${expiresIn} seconds`);
      console.log("");

      if (accounts.length > 0) {
        console.log("Trading accounts linked to this token (ctidTraderAccountId):\n");
        for (const a of accounts) {
          const id = pick(a, "ctidTraderAccountId", "traderLogin", "accountId");
          const isLive = pick(a, "live", "isLive");
          console.log(
            `  CTRADER_ACCOUNT_ID=${id}   ${isLive ? "(LIVE)" : "(demo)"}  ${JSON.stringify(a)}`,
          );
        }
        console.log(
          "\nPick the id matching your CTRADER_ENV (demo/live) and put it in .env.",
        );
      } else {
        console.log(
          "No accounts returned automatically. Find your ctidTraderAccountId in cTrader " +
            "under Settings, or via the Open API playground.",
        );
      }

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 500);
    } catch (err) {
      console.error("OAuth error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("OAuth exchange failed. Check the terminal.");
      setTimeout(() => process.exit(1), 500);
    }
  });

  server.listen(port, () => {
    /* listening; user opens the URL above */
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
