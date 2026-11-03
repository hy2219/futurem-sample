import { createHash } from "node:crypto";
import { GET, POST } from "./route.js";
import { loginState } from "../../../auth/session.js";

beforeEach(() => {
  vi.stubEnv("APP_CLIENT_ID", "unit-client");
  vi.stubEnv("SSO_SESSION_KEY", "unit-key");
  vi.stubEnv("APP_RUNTIME_NODE_ENV", "development");
});
const context = (action: string) => ({ params: Promise.resolve({ action }) });

test("starts SSO with signed state, exact callback, and S256 PKCE", async () => {
  const response = await GET(new Request("http://app/auth/login"), context("login"));
  expect(response.status).toBe(303);
  const target = new URL(response.headers.get("location") ?? "", "http://app");
  expect(target.pathname).toBe("/sso/authorize");
  expect(target.searchParams.get("redirect_uri")).toBe("/auth/callback");
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  expect(target.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("rejects absent, mismatched and duplicate state before code exchange and clears transient cookies", async () => {
  const pending = loginState();
  for (const search of ["", "?state=wrong&code=bad", `?state=${pending.state}&state=${pending.state}&code=${"a".repeat(64)}`]) {
    const response = await GET(new Request(`http://app/auth/callback${search}`, {
      headers: { cookie: `demo_login=${pending.signed}` },
    }), context("callback"));
    expect(response.status).toBe(400);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  }
  expect(createHash("sha256").update(pending.verifier).digest("base64url")).toHaveLength(43);
});

test("logout is POST-only, origin protected, and clears both cookies", async () => {
  expect((await GET(new Request("http://app/auth/logout"), context("logout"))).status).toBe(404);
  expect((await POST(new Request("http://app/auth/logout", { method: "POST" }), context("logout"))).status).toBe(403);
  const response = await POST(new Request("http://app/auth/logout", { method: "POST", headers: { origin: "http://app" } }), context("logout"));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("demo_session=;");
  expect(response.headers.get("set-cookie")).toContain("demo_login=;");
});
