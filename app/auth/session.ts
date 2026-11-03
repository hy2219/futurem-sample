import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function signature(value: string) {
  return createHmac("sha256", setting("SSO_SESSION_KEY")).update(value).digest("base64url");
}

export function equal(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function sessionClaims(token: string): { sub: string; exp: number } | null {
  try {
    const [header, payload, mac, extra] = token.split(".");
    if (!header || !payload || !mac || extra !== undefined || !equal(signature(`${header}.${payload}`), mac)) return null;
    const metadata = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (metadata.alg !== "HS256" || metadata.typ !== "JWT" ||
      claims.iss !== "simplified-sdlc-sso" || claims.aud !== setting("APP_CLIENT_ID") ||
      claims.sub !== "demo" || claims.name !== "Demo User" || claims.mock !== true ||
      typeof claims.jti !== "string" || !claims.jti ||
      !Number.isInteger(claims.iat) || claims.iat > now ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 900) return null;
    return { sub: claims.sub, exp: claims.exp };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0]?.slice(name.length + 1) ?? "" : "";
}

export function authenticated(request: Request): boolean {
  return sessionClaims(readCookie(request, "demo_session")) !== null;
}

export function loginState(): { state: string; verifier: string; signed: string } {
  const state = randomBytes(32).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    state, verifier, exp: Math.floor(Date.now() / 1000) + 300, aud: setting("APP_CLIENT_ID"),
  })).toString("base64url");
  return { state, verifier, signed: `${payload}.${signature(`login:${payload}`)}` };
}

export function readLoginState(value: string): { state: string; verifier: string } | null {
  try {
    const [payload, mac, extra] = value.split(".");
    if (!payload || !mac || extra !== undefined || !equal(signature(`login:${payload}`), mac)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!/^[a-f0-9]{64}$/.test(state.state) || !/^[\w-]{43}$/.test(state.verifier) ||
      !Number.isInteger(state.exp) || state.exp <= Date.now() / 1000 ||
      state.aud !== setting("APP_CLIENT_ID")) return null;
    return { state: state.state, verifier: state.verifier };
  } catch {
    return null;
  }
}

function secure() {
  return (process.env.APP_RUNTIME_NODE_ENV ?? process.env.NODE_ENV) !== "development";
}

export function cookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(seconds))}; HttpOnly; SameSite=Lax${secure() ? "; Secure" : ""}`;
}

export function sameOrigin(request: Request): boolean {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return request.headers.get("origin") === `${secure() ? "https" : "http"}://${host}`;
}
