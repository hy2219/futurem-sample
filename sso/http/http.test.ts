import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "vitest";
import type { Express } from "express";
import { application, errors, HttpError, required } from "./http.js";

async function localHttp(t: TestContext, configure: (app: Express) => void = () => {}): Promise<string> {
  const app = application();
  configure(app);
  errors(app);
  const server = createServer(app);
  t.onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("required validates missing, empty, and minimum-length environment values", () => {
  assert.equal(required({ VALUE: "ok" }, "VALUE"), "ok");
  assert.equal(required({ VALUE: "abc" }, "VALUE", 3), "abc");
  assert.throws(() => required({}, "VALUE"), /Missing or invalid VALUE/);
  assert.throws(() => required({ VALUE: "" }, "VALUE"), /Missing or invalid VALUE/);
  assert.throws(() => required({ VALUE: "ab" }, "VALUE", 3), /Missing or invalid VALUE/);
});

test("application serves health and favicon with safe headers", async t => {
  const url = await localHttp(t);
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("referrer-policy"), "no-referrer");
  assert.match(health.headers.get("content-security-policy") ?? "", /script-src 'none'/);
  const favicon = await fetch(`${url}/favicon.ico`);
  assert.equal(favicon.status, 204);
  assert.equal(await favicon.text(), "");
});

test("errors maps expected failures and hides unexpected error details", async t => {
  const url = await localHttp(t, app => {
    app.get("/denied", () => { throw new HttpError(401, "Demo account required"); });
    app.get("/failure", () => { throw new Error("private signing key"); });
  });
  for (const [path, status, error] of [
    ["/missing", 404, "Not found"],
    ["/denied", 401, "Demo account required"],
    ["/failure", 500, "Service request failed"],
  ] as const) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
});

test("errors rejects malformed and oversized request bodies without echoing them", async t => {
  const url = await localHttp(t, app => {
    app.post("/body", (_req, res) => res.json({ status: "accepted" }));
  });
  for (const [body, status] of [
    ['{"password":', 400],
    [JSON.stringify({ password: "x".repeat(17000) }), 413],
  ] as const) {
    const response = await fetch(`${url}/body`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Invalid request" });
  }
});
