import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { equalSecret, signToken } from "./tokens.js";

import { makeEnvironment } from "../__mocks__/server.js";
const { SSO_SESSION_KEY: keyText, APP_CLIENT_ID: clientId } = makeEnvironment();

test("seeded SSO environments are reproducible and independently generated", () => {
  assert.deepEqual(makeEnvironment(7), makeEnvironment(7));
  assert.notDeepEqual(makeEnvironment(7), makeEnvironment(8));
});

test("equalSecret handles equal, different length, different value, and non-string inputs", () => {
  assert.equal(equalSecret("same-secret", "same-secret"), true);
  assert.equal(equalSecret("short", "much-longer-secret"), false);
  assert.equal(equalSecret("first", "other"), false);
  assert.equal(equalSecret(undefined, "secret"), false);
  assert.equal(equalSecret("secret", null), false);
  assert.equal(equalSecret(123, 123), false);
});

test("signToken creates a verifiable HS256 token and rejects wrong keys/audiences", async () => {
  const token = await signToken(keyText, "test-issuer", clientId, "demo", { mock: true }, 900);
  const key = new TextEncoder().encode(keyText);
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    issuer: "test-issuer", audience: clientId, algorithms: ["HS256"],
    requiredClaims: ["exp", "iat", "jti"],
  });
  assert.deepEqual(protectedHeader, { alg: "HS256", typ: "JWT" });
  assert.equal(payload.sub, "demo");
  assert.equal(payload.mock, true);
  assert.equal(payload.exp! - payload.iat!, 900);
  assert.equal(typeof payload.jti, "string");
  await assert.rejects(jwtVerify(token, new TextEncoder().encode("wrong-key")));
  await assert.rejects(jwtVerify(token, key, { audience: "another-client" }));
  await assert.rejects(jwtVerify(token, key, { issuer: "another-issuer" }));
  await assert.rejects(jwtVerify(token, key, { currentDate: new Date(payload.exp! * 1000) }), {
    code: "ERR_JWT_EXPIRED",
  });
});

test("signToken defaults to a 60 second lifetime and assigns distinct token IDs", async () => {
  const key = new TextEncoder().encode(keyText);
  const first = await jwtVerify(await signToken(keyText, "test-issuer", clientId, "demo"), key);
  const second = await jwtVerify(await signToken(keyText, "test-issuer", clientId, "demo"), key);
  assert.equal(first.payload.exp! - first.payload.iat!, 60);
  assert.notEqual(first.payload.jti, second.payload.jti);
});
