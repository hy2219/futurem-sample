import assert from "node:assert/strict";
import { once } from "node:events";
import { data, definition } from "../resources/resource.js";
import { createApi } from "../server.js";
import { required } from "../auth/tokens.js";
import { createApiEnv } from "../__mocks__/server.js";
import { issueResourceToken } from "../__mocks__/auth/tokens.js";

function checkApi(getTarget: () => { origin: string; env: NodeJS.ProcessEnv }) {
  let origin: string, id: string, key: string;
  let tokenEnv: { APP_CLIENT_ID: string; RESOURCE_TOKEN_KEY: string };
  beforeAll(() => {
    const target = getTarget();
    origin = target.origin;
    id = required(target.env, "APP_CLIENT_ID");
    key = required(target.env, "RESOURCE_TOKEN_KEY", 32);
    tokenEnv = { APP_CLIENT_ID: id, RESOURCE_TOKEN_KEY: key };
  });
  const call = (token?: string, values: Record<string, string> = {}) => fetch(
    `${origin}${definition.path}?${new URLSearchParams(values)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10000),
    },
  );
  test("health and readiness are public; unknown routes are 404", async () => {
    for (const [path, status] of [["/health", "ok"], ["/ready", "ready"]]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status });
    }
    assert.equal((await fetch(`${origin}/unknown`)).status, 404);
  });
  test("default and filtered requests return only the real fixtures", async () => {
    for (const [values, expected] of [
      [{}, { maintenance_windows: data }],
      [{ asset_id: "AST-001" }, { maintenance_windows: [data[0]] }],
      [{ asset_id: "AST-004" }, { maintenance_windows: [] }],
      [{ asset_id: "missing" }, { maintenance_windows: [] }],
    ] as const) {
      const response = await call(await issueResourceToken(tokenEnv), values);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, expected);
      assert.ok(!JSON.stringify(body).includes("internal"));
    }
  });
  test("absent, malformed, expired, wrong audience/subject/issuer/signature/algorithm and claims are 401", async () => {
    const tokens = [
      undefined, "invalid", await issueResourceToken(tokenEnv, { exp: Math.floor(Date.now() / 1000) - 1 }),
      await issueResourceToken(tokenEnv, { aud: "other.resource" }), await issueResourceToken(tokenEnv, { sub: `${id}-other` }),
      await issueResourceToken(tokenEnv, { iss: "other.issuer" }), await issueResourceToken(tokenEnv, {}, "wrong-key".repeat(8)),
      await issueResourceToken(tokenEnv, {}, key.repeat(2), "HS384"), await issueResourceToken(tokenEnv, { iat: undefined }),
      await issueResourceToken(tokenEnv, { exp: undefined }), await issueResourceToken(tokenEnv, { jti: undefined }), await issueResourceToken(tokenEnv, { jti: "" }),
      await issueResourceToken(tokenEnv, { iat: Math.floor(Date.now() / 1000) + 30 }),
    ];
    for (const token of tokens) {
      const response = await call(token);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      const body = JSON.stringify(await response.json());
      assert.ok(!body.includes(key) && (!token || !body.includes(token)));
    }
    assert.equal((await call(await issueResourceToken(tokenEnv, { scope: "forbidden:write" }))).status, 403);
    assert.equal((await call(await issueResourceToken(tokenEnv, { scope: undefined }))).status, 403);
  });
  test("invalid, repeated and unknown query inputs are 400; body limit is 16KB", async () => {
    for (const values of [{ asset_id: "" }, { sql: "SELECT *" }] as Record<string, string>[]) {
      assert.equal((await call(await issueResourceToken(tokenEnv), values)).status, 400);
    }
    assert.equal((await fetch(`${origin}${definition.path}?asset_id=AST-001&asset_id=AST-003`, {
      headers: { Authorization: `Bearer ${await issueResourceToken(tokenEnv)}` },
    })).status, 400);
    const request = (body: string, type = "application/json") => fetch(`${origin}${definition.path}`, {
      method: "POST", headers: { "Content-Type": type }, body, signal: AbortSignal.timeout(10000),
    });
    assert.equal((await request("{")).status, 400);
    assert.equal((await request(JSON.stringify({ value: "x".repeat(16384) }))).status, 413);
    assert.equal((await request("x".repeat(16385), "text/plain")).status, 413);
  });
}

describe("api_1 in-process HTTP contract and required startup configuration", () => {
  const env = createApiEnv();
  let origin: string;
  beforeAll(async () => {
    assert.throws(() => createApi({}), /APP_CLIENT_ID/);
    assert.throws(() => createApi({ APP_CLIENT_ID: env.APP_CLIENT_ID }), /RESOURCE_TOKEN_KEY/);
    const server = createApi(env).listen(0, "127.0.0.1");
    afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
  });
  checkApi(() => ({ origin, env }));
});

describe("api_1 live container HTTP contract", () => {
  checkApi(() => ({ origin: process.env.API_1_URL ?? "http://127.0.0.1:3103", env: process.env }));
});
