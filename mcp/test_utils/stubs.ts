import { Faker, en } from "@faker-js/faker";
import type { ResourceManifest } from "../resources/resource.js";

export function makeUpstreamPayload(seed = 2219) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return { value: faker.number.int({ min: 1, max: 100 }) };
}

export function makeResourceOutput(id = "api", seed = 2219) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return { message: `${id}: ${faker.lorem.sentence()}` };
}

export function makeHttpPeerData() {
  const resource = makeHttpResource("api");
  resource.connection.urlEnv = "API_URL";
  resource.tools[0].operation.path = "/values";
  return {
    resource,
    env: { ...makeEnvironment(), API_URL: "http://example.test" },
    result: makeResourceOutput(resource.id),
  };
}

export function makeEnvironment(seed = 2219) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return {
    APP_CLIENT_ID: faker.string.uuid(),
    APP_CLIENT_SECRET: faker.string.alphanumeric(64),
    RESOURCE_TOKEN_KEY: faker.string.alphanumeric(64),
  };
}

export function makeHttpResource(id = "api_3", seed = 2219): Extract<ResourceManifest, { type: "http" }> {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return {
    version: 1, id, type: "http", connection: { urlEnv: "TEST_API_URL" },
    tools: [{
      name: `call_${id}`, title: faker.commerce.productName(), description: faker.lorem.sentence(),
      authorization: { audience: `test.${id}`, scope: "message:read" },
      operation: { method: "GET", path: "/data" },
      inputSchema: {
        type: "object", additionalProperties: false, required: ["message"],
        properties: { message: { type: "string", minLength: 1 } },
      },
      outputSchema: {
        type: "object", additionalProperties: false, required: ["message"],
        properties: { message: { type: "string", minLength: 1 } },
      },
    }],
  };
}
