import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, assertConfig } from "./config.js";
import { ctrader } from "./ctrader/client.js";
import { createMcpServer } from "./mcp.js";

async function main(): Promise<void> {
  assertConfig();

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "ctrader-mcp" });
  });

  const handlePost = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          if (transport) transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid) delete transports[sid];
      };
      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session id provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };

  const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session id");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  // Serve both /mcp and /mcp/ (the .mcp.json url uses a trailing slash).
  for (const path of ["/mcp", "/mcp/"]) {
    app.post(path, handlePost);
    app.get(path, handleSessionRequest);
    app.delete(path, handleSessionRequest);
  }

  app.listen(config.mcp.port, config.mcp.host, () => {
    console.error(
      `[ctrader-mcp] MCP server listening on http://${config.mcp.host}:${config.mcp.port}/mcp/`,
    );
  });

  // Connect to cTrader in the background so the MCP server is available immediately.
  // Tools also reconnect lazily on first use if this initial attempt fails.
  console.error(
    `[ctrader-mcp] connecting to cTrader (${config.ctrader.env} @ ${config.ctrader.host}:${config.ctrader.port})...`,
  );
  ctrader
    .connect()
    .then(() =>
      console.error("[ctrader-mcp] connected and authenticated with cTrader Open API"),
    )
    .catch((err) =>
      console.error(
        "[ctrader-mcp] initial cTrader connect failed (will retry on demand):",
        err instanceof Error ? err.message : err,
      ),
    );
}

main().catch((err) => {
  console.error("[ctrader-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
