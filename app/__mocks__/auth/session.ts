import { createHmac } from "node:crypto";

export function signedRequest(search = "") {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "simplified-sdlc-sso", aud: process.env.APP_CLIENT_ID, sub: "demo",
    name: "Demo User", mock: true, exp: now + 900, iat: now, jti: "route-unit",
  })).toString("base64url");
  const token = `${header}.${payload}.${createHmac("sha256", process.env.SSO_SESSION_KEY ?? "").update(`${header}.${payload}`).digest("base64url")}`;
  return new Request(`http://app/api/assets${search}`, { headers: { cookie: `demo_session=${token}` } });
}
