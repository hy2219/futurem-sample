import { jwtVerify } from "jose";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function required(env: NodeJS.ProcessEnv, name: string, minimum = 1): string {
  const value = env[name];
  if (!value || value.trim().length < minimum) throw new Error(`${name} is required (minimum ${minimum} characters)`);
  return value;
}

export async function verifyResourceToken(
  header: string | undefined, key: string, clientId: string, audience: string, scope: string,
): Promise<void> {
  if (!header || !/^Bearer [^\s]+$/i.test(header)) throw new HttpError(401, "Resource token required");
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(key), {
      algorithms: ["HS256"],
      issuer: "simplified-sdlc-runtime",
      audience,
      subject: clientId,
      requiredClaims: ["exp", "iat", "jti", "sub"],
    }));
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) ||
        payload.iat > Math.floor(Date.now() / 1000) ||
        typeof payload.exp !== "number" || payload.exp <= payload.iat ||
        typeof payload.jti !== "string" || !payload.jti.trim()) {
      throw new Error("Invalid claims");
    }
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  if (payload.scope !== scope) throw new HttpError(403, "Resource operation not permitted");
}
