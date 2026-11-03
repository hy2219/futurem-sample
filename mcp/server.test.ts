import type { TestContext } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { z } from "zod";
import { createRuntime } from "./server.js";
import { basicCredentials, resourceToken } from "./auth/tokens.js";
import { withMcp } from "./protocol/mcp.js";
import { loadRegistry, packageResources } from "./resources/registry.js";
import { makeEnvironment } from "./__mocks__/auth/tokens.js";
import { makeHttpResource } from "./__mocks__/resources/registry.js";
import { adapters, createAdapters, resetAdapters } from "./__mocks__/resources/adapters.js";

vi.mock("./resources/adapters.js", () => import("./__mocks__/resources/adapters.js"));
beforeEach(resetAdapters);

async function runtimeFixture(t: TestContext) {
  const directory = mkdtempSync(join(process.cwd(), ".server-unit-"));
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const env = makeEnvironment();
  for (const resource of [makeHttpResource("api_3"), makeHttpResource("api_4", 2220)]) {
    mkdirSync(join(directory, resource.id));
    writeFileSync(join(directory, resource.id, "resource.json"), JSON.stringify(resource));
  }
  const registryPath = join(directory, "compiled", "registry.json");
  packageResources(directory, registryPath);
  const registry = loadRegistry(registryPath);
  const runtime = createRuntime(env, registryPath);
  assert.equal(createAdapters.mock.calls.length, 1);
  assert.deepEqual(createAdapters.mock.calls[0], [registry.manifests, env]);
  assert.equal(adapters.size, registry.manifests.length);
  const server = createServer(runtime.app);
  t.onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await runtime.close();
    for (const adapter of adapters.values()) assert.equal(adapter.close.mock.calls.length, 1);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    env, registry, origin: `http://127.0.0.1:${address.port}`,
    authorization: basicCredentials(env.APP_CLIENT_ID, env.APP_CLIENT_SECRET),
  };
}

test("server validates mandatory app authentication before creating adapters", () => {
  assert.throws(() => createRuntime({}), /APP_CLIENT_ID/);
  assert.throws(() => createRuntime({ APP_CLIENT_ID: "test-client" }), /APP_CLIENT_SECRET/);
  assert.throws(() => createRuntime({ APP_CLIENT_ID: "test-client", APP_CLIENT_SECRET: "fixture".repeat(8) }), /RESOURCE_TOKEN_KEY/);
  assert.equal(createAdapters.mock.calls.length, 0);
});

test("server readiness reaches every imported adapter without real connection settings", async (t) => {
  const { origin } = await runtimeFixture(t);
  const response = await fetch(`${origin}/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ready" });
  for (const adapter of adapters.values()) {
    assert.equal(adapter.ready.mock.calls.length, 1);
    assert.equal(adapter.call.mock.calls.length, 0);
  }
});

test("server readiness propagates a prepared adapter failure as a safe 503", async (t) => {
  const { origin } = await runtimeFixture(t);
  adapters.get("api_4")!.failReady();
  const response = await fetch(`${origin}/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Resource not ready" });
  for (const adapter of adapters.values()) assert.equal(adapter.ready.mock.calls.length, 1);
});

test("server lists exact registry metadata and calls imported adapters through the real MCP SDK", async (t) => {
  const { env, registry, origin, authorization } = await runtimeFixture(t);
  await withMcp(`${origin}/mcp`, authorization, async (client) => {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(({ name, title, description, inputSchema, outputSchema }) => ({
      name, title, description, inputSchema, outputSchema,
    })), registry.tools.map((tool) => ({
      name: tool.name, title: tool.title, description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }),
      outputSchema: z.toJSONSchema(z.object({ result: tool.output }), { target: "draft-7", io: "output" }),
    })));
    for (const tool of registry.tools) {
      const adapter = adapters.get(tool.resourceId)!;
      assert.equal(adapter.call.mock.calls.length, 0);
      const input = { message: `input for ${tool.resourceId}` };
      const response = await client.callTool({ name: tool.name, arguments: input });
      assert.notEqual(response.isError, true);
      assert.deepEqual(response.structuredContent, { result: adapter.result });
      assert.deepEqual(response.content, [{ type: "text", text: JSON.stringify(adapter.result) }]);
      assert.equal(adapter.call.mock.calls.length, 1);
      const [calledTool, calledInput, token] = adapter.call.mock.calls[0];
      assert.deepEqual(calledTool, tool.tool);
      assert.deepEqual(calledInput, input);
      await resourceToken(`Bearer ${token}`, env.RESOURCE_TOKEN_KEY,
        tool.tool.authorization.audience, env.APP_CLIENT_ID, tool.tool.authorization.scope);
    }
  });
});

test("server rejects invalid MCP inputs before calling the prepared adapter", async (t) => {
  const { origin, authorization } = await runtimeFixture(t);
  await withMcp(`${origin}/mcp`, authorization, async (client) => {
    for (const input of [{}, { message: 7 }, { message: "valid", unexpected: true }]) {
      const response = await client.callTool({ name: "call_api_3", arguments: input });
      assert.equal(response.isError, true);
      assert.match(JSON.stringify(response.content), /Invalid arguments/);
    }
  });
  for (const adapter of adapters.values()) assert.equal(adapter.call.mock.calls.length, 0);
});

test("server enforces its real output schema on prepared adapter results", async (t) => {
  const { origin, authorization } = await runtimeFixture(t);
  const adapter = adapters.get("api_3")!;
  adapter.badOutput();
  await withMcp(`${origin}/mcp`, authorization, async (client) => {
    const response = await client.callTool({ name: "call_api_3", arguments: { message: "valid input" } });
    assert.equal(response.isError, true);
    assert.deepEqual(response.content, [{ type: "text", text: "Resource result does not match its output schema" }]);
  });
  assert.equal(adapter.call.mock.calls.length, 1);
});

test("server propagates the imported adapter's prepared call failure", async (t) => {
  const { origin, authorization } = await runtimeFixture(t);
  const adapter = adapters.get("api_3")!;
  adapter.failCall();
  await withMcp(`${origin}/mcp`, authorization, async (client) => {
    const response = await client.callTool({ name: "call_api_3", arguments: { message: "valid input" } });
    assert.equal(response.isError, true);
    assert.deepEqual(response.content, [{ type: "text", text: "Prepared adapter call failure" }]);
  });
  assert.equal(adapter.call.mock.calls.length, 1);
});
