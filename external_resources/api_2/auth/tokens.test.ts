import assert from "node:assert/strict";
import { HttpError, required, verifyResourceToken } from "./tokens.js";
import { definition } from "../resources/resource.js";
import { createApiEnv, createTokenClaims, issueResourceToken } from "../__mocks__/auth/tokens.js";

const env = createApiEnv();
const { RESOURCE_TOKEN_KEY: key, APP_CLIENT_ID: clientId } = env;
const { audience, scope } = definition;
const verify = (token: string) => verifyResourceToken(`Bearer ${token}`, key, clientId, audience, scope);
const errorWithStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

test("prepared API factories support replacement, one-shot results, history and seeded reset", async () => {
  const original = createApiEnv(7);
  const scenario = { ...original, APP_CLIENT_ID: "scenario-client" };
  createApiEnv.mockClear();
  createApiEnv.mockImplementation(() => scenario).mockReturnValueOnce(original);
  assert.deepEqual(createApiEnv(8), original);
  assert.deepEqual(createApiEnv(9), scenario);
  assert.deepEqual(createApiEnv.mock.calls, [[8], [9]]);
  createApiEnv.mockReset();
  assert.deepEqual(createApiEnv(7), original);
  const times = { iat: 100, exp: 160 };
  const claims = createTokenClaims(clientId, times, 7);
  createTokenClaims.mockReset();
  createTokenClaims.mockImplementation(() => ({ ...claims, scope: "scenario:read" }));
  assert.equal(createTokenClaims(clientId, times, 8).scope, "scenario:read");
  assert.deepEqual(createTokenClaims.mock.calls, [[clientId, times, 8]]);
  createTokenClaims.mockReset();
  assert.deepEqual(createTokenClaims(clientId, times, 7), claims);
  issueResourceToken.mockImplementation(async () => { throw new Error("Scenario issuer failure"); });
  await assert.rejects(issueResourceToken(env), /Scenario issuer failure/);
  issueResourceToken.mockReset();
  await assert.doesNotReject(verify(await issueResourceToken(env)));
  createApiEnv.mockImplementation(() => { throw new Error("Scenario environment failure"); });
});

test("mockReset restores API factories and clears previous scenario histories", () => {
  assert.deepEqual(createApiEnv.mock.calls, []);
  assert.deepEqual(createTokenClaims.mock.calls, []);
  assert.deepEqual(issueResourceToken.mock.calls, []);
  assert.deepEqual(createApiEnv(), env);
  assert.notDeepEqual(createApiEnv(7), createApiEnv(8));
});

test("api_2 tokens requires nonblank configuration and enforces minimum length", () => {
  for (const value of [undefined, "", " "]) {
    assert.throws(() => required({ APP_CLIENT_ID: value }, "APP_CLIENT_ID"), /APP_CLIENT_ID/);
  }
  assert.throws(() => required({ RESOURCE_TOKEN_KEY: "x".repeat(31) }, "RESOURCE_TOKEN_KEY", 32), /RESOURCE_TOKEN_KEY/);
  assert.equal(required({ RESOURCE_TOKEN_KEY: key }, "RESOURCE_TOKEN_KEY", 32), key);
  assert.equal(required({ APP_CLIENT_ID: clientId }, "APP_CLIENT_ID"), clientId);
});

test("api_2 tokens accepts a valid resource token", async () => {
  await assert.doesNotReject(verify(await issueResourceToken(env)));
});

test("api_2 test credentials and token claims are repeatable and seed-isolated", () => {
  const first = createApiEnv(42);
  createApiEnv(7);
  assert.deepEqual(createApiEnv(42), first);
  assert.notDeepEqual(createApiEnv(43), first);
  const now = Math.floor(Date.now() / 1000);
  const times = { iat: now, exp: now + 60 };
  const claims = createTokenClaims(first.APP_CLIENT_ID, times, 42);
  createTokenClaims(first.APP_CLIENT_ID, times, 7);
  assert.deepEqual(createTokenClaims(first.APP_CLIENT_ID, times, 42), claims);
  assert.notEqual(createTokenClaims(first.APP_CLIENT_ID, times, 43).jti, claims.jti);
});

test("api_2 tokens rejects absent or malformed authorization headers", async () => {
  for (const header of [undefined, "", "Basic invalid", "Bearer invalid"]) {
    await assert.rejects(verifyResourceToken(header, key, clientId, audience, scope), errorWithStatus(401));
  }
});

test("api_2 tokens rejects expired resource tokens", async () => {
  await assert.rejects(verify(await issueResourceToken(env, { exp: Math.floor(Date.now() / 1000) - 60 })), errorWithStatus(401));
});

test("api_2 tokens rejects the wrong audience", async () => {
  await assert.rejects(verify(await issueResourceToken(env, { aud: "other.resource" })), errorWithStatus(401));
});

test("api_2 tokens rejects a token signed with the wrong key", async () => {
  await assert.rejects(verify(await issueResourceToken(env, {}, "wrong-key".repeat(8))), errorWithStatus(401));
});

test("api_2 tokens rejects missing or incorrect operation scopes", async () => {
  for (const value of [undefined, "forbidden:write"]) {
    await assert.rejects(verify(await issueResourceToken(env, { scope: value })), errorWithStatus(403));
  }
});
