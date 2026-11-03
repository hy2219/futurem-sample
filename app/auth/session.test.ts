import { createHmac } from "node:crypto";
import { authenticated, loginState, readLoginState, sessionClaims, cookie, sameOrigin } from "./session.js";

beforeEach(() => {
  vi.stubEnv("APP_CLIENT_ID", "unit-client");
  vi.stubEnv("SSO_SESSION_KEY", "unit-only-signing-key");
  vi.stubEnv("APP_RUNTIME_NODE_ENV", "development");
});

function token(claims: Record<string, unknown> = {}, header = { alg: "HS256", typ: "JWT" }) {
  const now = Math.floor(Date.now() / 1000);
  const body = [header, { iss: "simplified-sdlc-sso", aud: "unit-client", sub: "demo", name: "Demo User", mock: true, exp: now + 900, iat: now, jti: "unit-id", ...claims }]
    .map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return `${body}.${createHmac("sha256", process.env.SSO_SESSION_KEY ?? "").update(body).digest("base64url")}`;
}

test("validates the signed session and every required claim, not just decoded content", () => {
  expect(sessionClaims(token())).toMatchObject({ sub: "demo" });
  for (const claims of [
    { exp: 1 }, { iss: "other" }, { aud: "other" }, { sub: "other" },
    { jti: undefined }, { iat: undefined }, { mock: false }, { name: "Other" },
    { exp: Math.floor(Date.now() / 1000) + 3600 },
  ]) expect(sessionClaims(token(claims))).toBeNull();
  expect(sessionClaims(token({}, { alg: "none", typ: "JWT" }))).toBeNull();
  expect(sessionClaims(`${token()}tampered`)).toBeNull();
  expect(authenticated(new Request("http://app/api/assets"))).toBe(false);
  expect(authenticated(new Request("http://app/api/assets", { headers: { cookie: `demo_session=${token()}` } }))).toBe(true);
});

test("binds state and PKCE verifier to an expiring tamper-proof HttpOnly cookie", () => {
  const state = loginState();
  expect(state.state).toMatch(/^[a-f0-9]{64}$/);
  expect(state.verifier).toMatch(/^[\w-]{43}$/);
  expect(readLoginState(state.signed)).toMatchObject({ state: state.state, verifier: state.verifier });
  expect(readLoginState(`${state.signed}x`)).toBeNull();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 301000);
  expect(readLoginState(state.signed)).toBeNull();
  vi.useRealTimers();
  expect(cookie("demo_session", "x", 900)).toContain("HttpOnly; SameSite=Lax");
  expect(cookie("demo_session", "x", 900)).not.toContain("Secure");
  vi.stubEnv("APP_RUNTIME_NODE_ENV", "production");
  expect(cookie("demo_session", "x", 900)).toContain("Secure");
});

test("requires a real same-origin POST and never trusts forwarded browser headers", () => {
  expect(sameOrigin(new Request("http://app/auth/logout", { method: "POST", headers: { origin: "http://app" } }))).toBe(true);
  for (const origin of ["null", "http://evil", ""]) {
    expect(sameOrigin(new Request("http://app/auth/logout", { method: "POST", headers: { origin } }))).toBe(false);
  }
});
