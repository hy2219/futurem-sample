import { SignJWT } from "jose";
import type { JWTPayload } from "jose";
import { createApiEnv as createEnv, createTokenClaims as createClaims } from "../../test_utils/stubs.js";
import type { ApiTestEnv } from "../../test_utils/stubs.js";

const actual = await vi.importActual<typeof import("../../auth/tokens.js")>("../../auth/tokens.js");
export const HttpError = actual.HttpError;
export const required = vi.fn<typeof actual.required>(actual.required);
export const verifyResourceToken = vi.fn<typeof actual.verifyResourceToken>(async () => {});

// Preserve the production export contract while replacing only verification.
({ HttpError, required, verifyResourceToken } satisfies typeof import("../../auth/tokens.js"));

export const createApiEnv = vi.fn<typeof createEnv>(createEnv);
export const createTokenClaims = vi.fn<typeof createClaims>(createClaims);

function issueResourceTokenDefault(
  env: ApiTestEnv, claims: JWTPayload = {}, signingKey = env.RESOURCE_TOKEN_KEY, alg = "HS256",
): Promise<string> {
  return new SignJWT(createTokenClaims(env.APP_CLIENT_ID, claims))
    .setProtectedHeader({ alg }).sign(new TextEncoder().encode(signingKey));
}

export const issueResourceToken = vi.fn<typeof issueResourceTokenDefault>(issueResourceTokenDefault);
