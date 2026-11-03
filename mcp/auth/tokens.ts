import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";
import type { JWTPayload } from "jose";
import { HttpError } from "../http/http.js";

export function equalSecret(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" &&
    timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function basicCredentials(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export function checkCredentials(header: unknown, id: string, secret: string): void {
  if (typeof header !== "string" || !/^Basic [A-Za-z0-9+/]+=*$/.test(header)) throw new HttpError(401, "Invalid client credentials");
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const delimiter = decoded.indexOf(":");
  if (delimiter < 1 || !equalSecret(decoded.slice(0, delimiter), id) || !equalSecret(decoded.slice(delimiter + 1), secret)) {
    throw new HttpError(401, "Invalid client credentials");
  }
}

export async function signToken(key: string, issuer: string, audience: string, subject: string, claims: JWTPayload = {}, lifetime = 60) {
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt()
    .setJti(randomUUID()).setExpirationTime(Math.floor(Date.now() / 1000) + lifetime)
    .sign(new TextEncoder().encode(key));
}

export async function verifyToken(token: string, key: string, issuer: string, audience: string, subject?: string) {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(key), {
      algorithms: ["HS256"], issuer, audience,
      requiredClaims: ["exp", "iat", "sub", "jti"],
      ...(subject ? { subject } : {}),
    });
    return payload;
  } catch (error) {
    if (error instanceof errors.JOSEError) throw new HttpError(401, "Invalid or expired token");
    throw error;
  }
}

export async function resourceToken(header: unknown, key: string, audience: string, clientId: string, scope: string) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) throw new HttpError(401, "Resource token required");
  const payload = await verifyToken(header.slice(7), key, "simplified-sdlc-runtime", audience, clientId);
  if (payload.scope !== scope) throw new HttpError(403, "Resource operation not permitted");
  return payload;
}
