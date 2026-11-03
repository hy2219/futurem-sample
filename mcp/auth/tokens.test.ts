import assert from "node:assert/strict";
import { makeEnvironment } from "../__mocks__/auth/tokens.js";
import { basicCredentials, checkCredentials, equalSecret, resourceToken, signToken, verifyToken } from "./tokens.js";

const key = makeEnvironment().RESOURCE_TOKEN_KEY;
test("prepared environments support implementations, one-shot values and seeded reset", () => {
  const original = makeEnvironment(7);
  const scenario = { ...original, APP_CLIENT_ID: "scenario-client" };
  makeEnvironment.mockClear();
  makeEnvironment.mockImplementation(() => scenario).mockReturnValueOnce(original);
  assert.deepEqual(makeEnvironment(8), original);
  assert.deepEqual(makeEnvironment(9), scenario);
  assert.deepEqual(makeEnvironment.mock.calls, [[8], [9]]);
  makeEnvironment.mockReset();
  assert.deepEqual(makeEnvironment(7), original);
  makeEnvironment.mockImplementation(() => { throw new Error("Scenario environment failure"); });
  assert.throws(() => makeEnvironment(), /Scenario environment failure/);
});
test("mockReset restores environment defaults and clears prior scenario history", () => {
  assert.deepEqual(makeEnvironment.mock.calls, []);
  assert.equal(makeEnvironment().RESOURCE_TOKEN_KEY, key);
  assert.notDeepEqual(makeEnvironment(7), makeEnvironment(8));
});
test("timing-safe comparison handles missing and differing credentials", () => {
  assert.equal(equalSecret("secret", "secret"), true);
  assert.equal(equalSecret("secret", "other"), false);
  assert.equal(equalSecret(undefined, "secret"), false);
});
test("HTTP client credentials are distinct from tool inputs", () => {
  checkCredentials(basicCredentials("app", "secret"), "app", "secret");
  for (const header of [undefined, "Bearer fake", "Basic ???", basicCredentials("other", "secret"), basicCredentials("app", "wrong")]) {
    assert.throws(() => checkCredentials(header, "app", "secret"), { status: 401 });
  }
});
test("resource token verifies signature, client identity, audience and scope", async () => {
  const token = await signToken(key, "simplified-sdlc-runtime", "mock.api", "app", { scope: "products:read" });
  const claims = await resourceToken(`Bearer ${token}`, key, "mock.api", "app", "products:read");
  assert.equal(claims.sub, "app");
  assert.ok(typeof claims.exp === "number" && typeof claims.iat === "number");
  assert.ok(claims.exp > claims.iat);
  await assert.rejects(resourceToken(`Bearer ${token}`, key, "mock.db", "app", "products:read"), { status: 401 });
  await assert.rejects(resourceToken(`Bearer ${token}`, key, "mock.api", "other", "products:read"), { status: 401 });
  await assert.rejects(resourceToken(`Bearer ${token}`, key, "mock.api", "app", "products:write"), { status: 403 });
  await assert.rejects(resourceToken(`Bearer ${token}`, key + "different", "mock.api", "app", "products:read"), { status: 401 });
});
test("expired or absent token never grants resource access", async () => {
  const token = await signToken(key, "simplified-sdlc-runtime", "mock.api", "app", { scope: "products:read" }, -1);
  await assert.rejects(resourceToken(`Bearer ${token}`, key, "mock.api", "app", "products:read"), { status: 401 });
  await assert.rejects(resourceToken(undefined, key, "mock.api", "app", "products:read"), { status: 401 });
});
test("Mock SSO session and resource tokens cannot be interchanged", async () => {
  const token = await signToken(key, "simplified-sdlc-sso", "app", "demo", { mock: true }, 900);
  await assert.rejects(verifyToken(token, key, "simplified-sdlc-runtime", "mock.api", "app"), { status: 401 });
});
