import type { TestContext } from "vitest";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApi } from "./server.js";
import { createApiEnv } from "./__mocks__/server.js";
import { HttpError, verifyResourceToken } from "./auth/tokens.js";
import { data, definition, query } from "./resources/resource.js";

const env = createApiEnv();

vi.mock("./auth/tokens.js", () => import("./__mocks__/auth/tokens.js"));

async function localApi(t: TestContext): Promise<string> {
  const server = createApi(env).listen(0, "127.0.0.1");
  t.onTestFinished(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

test("api_1 server requires a client ID and a sufficiently long token key", () => {
  assert.throws(() => createApi({}), /APP_CLIENT_ID/);
  assert.throws(() => createApi({ ...env, APP_CLIENT_ID: " " }), /APP_CLIENT_ID/);
  assert.throws(() => createApi({ APP_CLIENT_ID: env.APP_CLIENT_ID }), /RESOURCE_TOKEN_KEY/);
  assert.throws(() => createApi({ ...env, RESOURCE_TOKEN_KEY: "short" }), /RESOURCE_TOKEN_KEY/);
});

test("api_1 server constructs an Express application without exposing its framework", () => {
  const app = createApi(env);
  assert.equal(typeof app, "function");
  assert.equal(typeof app.listen, "function");
  assert.equal(app.disabled("x-powered-by"), true);
});

test("api_1 server handles public health, readiness and unknown routes", async (t) => {
  const origin = await localApi(t);
  for (const [path, status, body] of [
    ["/health", 200, { status: "ok" }],
    ["/ready", 200, { status: "ready" }],
    ["/unknown", 404, { error: "Not found" }],
  ] as const) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get("x-powered-by"), null);
  }
});

test("api_1 routes use imported verification rather than validating the synthetic token", async t => {
  const origin = await localApi(t);
  const header = `Bearer ${env.APP_CLIENT_ID}`;
  const response = await fetch(`${origin}${definition.path}`, {
    headers: { Authorization: header }, signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), query({}));
  assert.ok(data.length > 0);
  expect(vi.mocked(verifyResourceToken)).toHaveBeenCalledExactlyOnceWith(
    header, env.RESOURCE_TOKEN_KEY, env.APP_CLIENT_ID, definition.audience, definition.scope,
  );
});

test("api_1 routes map the imported verifier rejection to a 403 response", async t => {
  const origin = await localApi(t);
  vi.mocked(verifyResourceToken).mockRejectedValueOnce(new HttpError(403, "Resource operation not permitted"));
  const response = await fetch(`${origin}${definition.path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Resource operation not permitted" });
  expect(vi.mocked(verifyResourceToken)).toHaveBeenCalledExactlyOnceWith(
    undefined, env.RESOURCE_TOKEN_KEY, env.APP_CLIENT_ID, definition.audience, definition.scope,
  );
});
