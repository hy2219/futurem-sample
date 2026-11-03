import { Faker, en } from "@faker-js/faker";
import { createHash } from "node:crypto";

export function makeEnvironment(seed = 2219) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return { APP_CLIENT_ID: faker.string.uuid(), SSO_SESSION_KEY: faker.string.alphanumeric(64) };
}

export function sessionToken(seed = 2222): string {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return `mock-session-${faker.string.uuid()}`;
}

export function authorization(clientId: string, seed = 2219): { verifier: string; params: Record<string, string> } {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  const verifier = faker.string.alphanumeric(43);
  return {
    verifier,
    params: {
      client_id: clientId, redirect_uri: "/auth/callback",
      state: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    },
  };
}
