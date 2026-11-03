import assert from "node:assert/strict";
import { createSso } from "./server.js";
import { equalSecret, signToken } from "./auth/tokens.js";
import { authorization, sessionToken } from "./__mocks__/auth/tokens.js";
import { issueCode, post } from "./integration/helpers/contract.js";
import { localSso } from "./integration/helpers/local-sso.js";
import { makeEnvironment } from "./__mocks__/server.js";
const env = makeEnvironment();

vi.mock("./auth/tokens.js", () => import("./__mocks__/auth/tokens.js"));
afterEach(() => vi.useRealTimers());

test("createSso requires a client ID and a signing key of at least 32 characters", async () => {
  assert.throws(() => createSso({}), /APP_CLIENT_ID/);
  assert.throws(() => createSso({ ...env, APP_CLIENT_ID: "" }), /APP_CLIENT_ID/);
  assert.throws(() => createSso({ APP_CLIENT_ID: env.APP_CLIENT_ID }), /SSO_SESSION_KEY/);
  assert.throws(() => createSso({ ...env, SSO_SESSION_KEY: "x".repeat(31) }), /SSO_SESSION_KEY/);
  await createSso({ ...env, SSO_SESSION_KEY: "x".repeat(32) }).close();
});

test("authorization codes expire exactly after 60 seconds", async t => {
  const target = await localSso(t);
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const exchange = await issueCode(target);
  vi.setSystemTime(now + 60000);
  const response = await post(target, "/token", exchange);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid or expired Mock SSO code" });
  expect(vi.mocked(signToken)).not.toHaveBeenCalled();
});

test("token route uses the prepared imported signer and returns its deterministic token", async t => {
  const target = await localSso(t);
  const exchange = await issueCode(target);
  const response = await post(target, "/token", exchange);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { session_token: sessionToken, expires_in: 900 });
  expect(vi.mocked(signToken)).toHaveBeenCalledExactlyOnceWith(
    target.key, "simplified-sdlc-sso", target.clientId, "demo", { name: "Demo User", mock: true }, 900,
  );
  expect(vi.mocked(equalSecret)).toHaveBeenCalledWith(target.clientId, target.clientId);
});

test("prepared SSO helpers and signer support standard overrides and reset", async () => {
  const original = makeEnvironment(7);
  makeEnvironment.mockClear();
  makeEnvironment.mockImplementation(() => original).mockReturnValueOnce(env);
  assert.deepEqual(makeEnvironment(8), env);
  assert.deepEqual(makeEnvironment(9), original);
  assert.deepEqual(makeEnvironment.mock.calls, [[8], [9]]);
  makeEnvironment.mockReset();
  assert.deepEqual(makeEnvironment(7), original);
  const request = authorization(env.APP_CLIENT_ID, 7);
  authorization.mockReset();
  authorization.mockImplementation(() => request);
  assert.deepEqual(authorization("scenario-client", 8), request);
  assert.deepEqual(authorization.mock.calls, [["scenario-client", 8]]);
  authorization.mockReset();
  assert.deepEqual(authorization(env.APP_CLIENT_ID, 7), request);
  vi.mocked(equalSecret).mockImplementation(() => false);
  assert.equal(equalSecret("same", "same"), false);
  vi.mocked(equalSecret).mockReset();
  assert.equal(equalSecret("same", "same"), true);
  vi.mocked(signToken).mockImplementation(async () => { throw new Error("Scenario signer failure"); });
  await assert.rejects(signToken(env.SSO_SESSION_KEY, "issuer", env.APP_CLIENT_ID, "demo"), /Scenario signer failure/);
});

test("mockReset restores the prepared signer and clears all SSO helper histories", async () => {
  assert.deepEqual(makeEnvironment.mock.calls, []);
  assert.deepEqual(authorization.mock.calls, []);
  assert.deepEqual(vi.mocked(signToken).mock.calls, []);
  assert.equal(await signToken(env.SSO_SESSION_KEY, "issuer", env.APP_CLIENT_ID, "demo"), sessionToken);
});
