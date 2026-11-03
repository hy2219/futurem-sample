import express from "express";
import type { ErrorRequestHandler } from "express";
import { definition, inputs, query } from "./resources/resource.js";
import { HttpError, required, verifyResourceToken } from "./auth/tokens.js";

export function createApi(env: NodeJS.ProcessEnv) {
  const clientId = required(env, "APP_CLIENT_ID");
  const key = required(env, "RESOURCE_TOKEN_KEY", 32);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(express.raw({ type: () => true, limit: "16kb" }));
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.get("/ready", (_req, res) => { res.json({ status: "ready" }); });
  app.get(definition.path, async (req, res) => {
    await verifyResourceToken(req.headers.authorization, key, clientId, definition.audience, definition.scope);
    const parsed = inputs.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "Invalid resource inputs");
    res.json(query(parsed.data));
  });
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      if (error.status === 401) res.set("WWW-Authenticate", "Bearer");
      res.status(error.status).json({ error: error.message });
      return;
    }
    const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
    if (type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
    } else if (type === "entity.parse.failed" || type === "request.aborted" || type === "request.size.invalid") {
      res.status(400).json({ error: "Invalid request body" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  };
  app.use(errors);
  return app;
}
