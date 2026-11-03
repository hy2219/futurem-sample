import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { z } from "zod";
import { authorization } from "../../__mocks__/auth/tokens.js";

export interface SsoTarget {
  url: string;
  clientId: string;
  key: string;
}


export function request(target: SsoTarget, path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, target.url), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
}

export function post(target: SsoTarget, path: string, body: Record<string, string>): Promise<Response> {
  return request(target, path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

export async function issueCode(target: SsoTarget): Promise<Record<string, string>> {
  const { params, verifier } = authorization(target.clientId);
  const response = await post(target, "/login", { ...params, username: "demo", password: "demo1234" });
  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const callback = new URL(location, target.url);
  assert.equal(callback.pathname, "/auth/callback");
  assert.equal(callback.searchParams.get("state"), params.state);
  const code = callback.searchParams.get("code");
  assert.ok(code);
  assert.match(code, /^[0-9a-f]{64}$/);
  return {
    client_id: target.clientId,
    code,
    redirect_uri: "/auth/callback",
    code_verifier: verifier,
    grant_type: "authorization_code",
  };
}

export function checkSsoContract(getTarget: () => SsoTarget): void {
  test("health and readiness are available", async () => {
    const target = getTarget();
    for (const [path, status] of [["/health", "ok"], ["/ready", "ready"]] as const) {
      const response = await request(target, path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-powered-by"), null);
    }
  });

  test("authorize uses only the demo account and serves its own stylesheet", async () => {
    const target = getTarget();
    const { params } = authorization(target.clientId);
    const response = await request(target, `/authorize?${new URLSearchParams(params)}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /MOCK SSO/);
    assert.match(html, /실제 회사 계정이나 비밀번호를 입력하지 마세요/);
    assert.match(html, /demo \/ demo1234/);
    assert.ok(!html.includes(target.key));
    assert.ok(!html.includes("SSO_SESSION_KEY"));
    assert.match(html, /action="login"/);
    assert.match(html, /href="theme.css"/);
    assert.equal(new URL("login", "http://example.test/sso/authorize").pathname, "/sso/login");
    assert.equal(new URL("theme.css", "http://example.test/sso/authorize").pathname, "/sso/theme.css");
    assert.match(response.headers.get("content-security-policy") ?? "", /style-src 'self'/);
    assert.ok(!(response.headers.get("content-security-policy") ?? "").includes("'unsafe-inline'"));
    const css = await request(target, "/theme.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await css.text(), /\.login-card/);
  });

  test("authorize rejects invalid clients, redirects, PKCE, state, and missing data", async () => {
    const target = getTarget();
    const { params } = authorization(target.clientId);
    const variants = [
      {},
      { ...params, client_id: "unregistered-client" },
      { ...params, redirect_uri: "https://example.test/auth/callback" },
      { ...params, redirect_uri: "//example.test/auth/callback" },
      { ...params, code_challenge_method: "plain" },
      { ...params, code_challenge: "invalid+challenge" },
      { ...params, state: "<script>" },
      { ...params, unexpected: "field" },
    ];
    for (const variant of variants) {
      const response = await request(target, `/authorize?${new URLSearchParams(variant)}`);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Invalid Mock SSO request" });
    }
  });

  test("login rejects non-demo credentials and invalid authorization data", async () => {
    const target = getTarget();
    const { params } = authorization(target.clientId);
    const cases: { body: Record<string, string>; status: number }[] = [
      { body: {}, status: 400 },
      { body: { ...params, username: "employee@example.test", password: "demo1234" }, status: 401 },
      { body: { ...params, username: "demo", password: "incorrect" }, status: 401 },
      { body: { ...params, username: "demo" }, status: 400 },
      { body: { ...params, username: "demo", password: "demo1234", client_id: "other-client" }, status: 400 },
      { body: { ...params, username: "demo", password: "demo1234", redirect_uri: "/other" }, status: 400 },
    ];
    for (const item of cases) {
      const response = await post(target, "/login", item.body);
      assert.equal(response.status, item.status);
      assert.equal(response.headers.get("location"), null);
      assert.ok(!JSON.stringify(await response.json()).includes(target.key));
    }
  });

  test("token verifies HS256 issuer, audience, demo identity, and 15 minute lifetime; replay fails", async () => {
    const target = getTarget();
    const exchange = await issueCode(target);
    const response = await post(target, "/token", exchange);
    assert.equal(response.status, 200);
    const body = z.object({ session_token: z.string(), expires_in: z.literal(900) }).strict().parse(await response.json());
    const { payload, protectedHeader } = await jwtVerify(body.session_token, new TextEncoder().encode(target.key), {
      algorithms: ["HS256"],
      issuer: "simplified-sdlc-sso",
      audience: target.clientId,
      subject: "demo",
      requiredClaims: ["exp", "iat", "jti"],
    });
    assert.equal(protectedHeader.typ, "JWT");
    assert.equal(payload.mock, true);
    assert.equal(payload.name, "Demo User");
    assert.equal(typeof payload.iat, "number");
    assert.equal(typeof payload.exp, "number");
    assert.equal(payload.exp! - payload.iat!, 900);
    assert.equal(typeof payload.jti, "string");
    assert.equal((await post(target, "/token", exchange)).status, 401);
  });

  test("a PKCE mismatch cannot exchange a code", async () => {
    const target = getTarget();
    const exchange = await issueCode(target);
    const mismatch = { ...exchange, code_verifier: authorization(target.clientId, 2220).verifier };
    assert.equal((await post(target, "/token", mismatch)).status, 401);
    assert.equal((await post(target, "/token", exchange)).status, 200);
  });

  test("token rejects invalid client, grant, redirect, missing data, and unknown codes", async () => {
    const target = getTarget();
    const exchange = await issueCode(target);
    const invalid = [
      {},
      { ...exchange, client_id: "other-client" },
      { ...exchange, grant_type: "client_credentials" },
      { ...exchange, redirect_uri: "/other" },
      { ...exchange, code_verifier: "short" },
      { ...exchange, code: "not-a-code" },
      { ...exchange, unexpected: "field" },
    ];
    for (const body of invalid) {
      assert.equal((await post(target, "/token", body)).status, 400);
    }
    assert.equal((await post(target, "/token", { ...exchange, code: authorization(target.clientId, 2221).params.state })).status, 401);
    assert.equal((await post(target, "/token", exchange)).status, 200);
  });

  test("concurrent exchanges consume a code once", async () => {
    const target = getTarget();
    const exchange = await issueCode(target);
    const responses = await Promise.all([post(target, "/token", exchange), post(target, "/token", exchange)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  });

  test("malformed JSON and unknown routes return safe errors", async () => {
    const target = getTarget();
    const malformed = await request(target, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"password\":",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Invalid request" });
    const oversized = await request(target, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(17000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: "Invalid request" });
    const missing = await request(target, "/not-found");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  });
}
