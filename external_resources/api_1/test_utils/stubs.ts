import { en, Faker } from "@faker-js/faker";
import type { JWTPayload } from "jose";
import { definition } from "../resources/resource.js";

export type ApiTestEnv = { APP_CLIENT_ID: string; RESOURCE_TOKEN_KEY: string };

export function createApiEnv(seed = 1101): ApiTestEnv {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return {
    APP_CLIENT_ID: `test-${faker.string.uuid()}`,
    RESOURCE_TOKEN_KEY: faker.string.alphanumeric(64),
  };
}

export function createTokenClaims(clientId: string, overrides: JWTPayload = {}, seed = 1102): JWTPayload {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "simplified-sdlc-runtime", aud: definition.audience, sub: clientId,
    iat: now, exp: now + 60, jti: faker.string.uuid(), scope: definition.scope, ...overrides,
  };
}
