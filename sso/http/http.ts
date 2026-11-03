import express from "express";
import type { Express, NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function required(env: NodeJS.ProcessEnv, name: string, minLength = 1): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < minLength) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

export function application(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/favicon.ico", (_req, res) => res.sendStatus(204));
  return app;
}

export function errors(app: Express): void {
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const type = error instanceof Error && "type" in error ? error.type : undefined;
    const status = error instanceof HttpError ? error.status :
      type === "entity.parse.failed" ? 400 : type === "entity.too.large" ? 413 : 500;
    console.error(JSON.stringify({ event: "sso_request_failed", status, code: error instanceof Error ? error.name : "UnknownError" }));
    res.status(status).json({
      error: status === 500 ? "Service request failed" :
        error instanceof HttpError ? error.message : "Invalid request",
    });
  });
}
