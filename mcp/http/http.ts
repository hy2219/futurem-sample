import express from "express";
import type { Express, Request, Response, NextFunction } from "express";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    if ("code" in error && typeof error.code === "string") return error.code;
    return error.name;
  }
  return "UnknownError";
}

export function application() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/favicon.ico", (req, res) => res.sendStatus(204));
  return app;
}

export function errors(app: Express) {
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const type = error instanceof Error && "type" in error ? error.type : undefined;
    const status = error instanceof HttpError ? error.status :
      type === "entity.parse.failed" ? 400 : type === "entity.too.large" ? 413 : 500;
    console.error(JSON.stringify({ event: "request_failed", status, code: errorCode(error) }));
    res.status(status).json({ error: status === 500 ? "Service request failed" :
      error instanceof Error ? error.message : "Invalid request" });
  });
  return app;
}

export function required(env: NodeJS.ProcessEnv, name: string, minLength = 1): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < minLength) throw new Error(`Missing or invalid ${name}`);
  return value;
}

export async function requestJson(url: string, options: RequestInit = {}): Promise<unknown> {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) throw new HttpError(502, "Upstream service unavailable");
    throw error;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(502, "Invalid upstream response");
    throw error;
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ?
      body.error : "Upstream request failed";
    throw new HttpError(response.status, message);
  }
  return body;
}
