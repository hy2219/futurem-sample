import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "vitest";
import { createSso } from "../../server.js";
import type { SsoTarget } from "./contract.js";
import { makeEnvironment } from "../../__mocks__/server.js";

export const env = makeEnvironment();

export async function localSso(t: Pick<TestContext, "onTestFinished">): Promise<SsoTarget> {
  const service = createSso(env);
  const server = createServer(service.app);
  t.onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await service.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, clientId: env.APP_CLIENT_ID, key: env.SSO_SESSION_KEY };
}
