import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import type { JWTPayload } from "jose";

export function equalSecret(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" &&
    timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export async function signToken(
  key: string,
  issuer: string,
  audience: string,
  subject: string,
  claims: JWTPayload = {},
  lifetime = 60,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetime)
    .sign(new TextEncoder().encode(key));
}
