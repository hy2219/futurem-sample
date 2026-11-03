import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import type { TestContext } from "vitest";
import { jwtVerify } from "jose";
import { registerResources, discoverResources, packageResources, loadRegistry } from "../resources/registry.js";
import { createAdapters } from "../resources/adapters.js";
import { createRuntime } from "../server.js";
import { withMcp, serveMcp } from "../protocol/mcp.js";
import { basicCredentials, resourceToken } from "../auth/tokens.js";
import { application, errors } from "../http/http.js";
import { z } from "zod";
import type { ResourceManifest } from "../resources/resource.js";
import { compileSchema, decodeQuery } from "../resources/resource.js";

import { makeEnvironment } from "../__mocks__/auth/tokens.js";
import { makeHttpResource as resource } from "../__mocks__/resources/registry.js";
const env = makeEnvironment();
function directory(t: TestContext) {
  const path = mkdtempSync(join(process.cwd(), ".mcp-resources-"));
  t.onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function writeManifest(root: string, value: ResourceManifest) {
  mkdirSync(join(root, value.id), { recursive: true });
  writeFileSync(join(root, value.id, "resource.json"), JSON.stringify(value));
}
async function listen(t: TestContext, server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("resource directories are discovered, compiled, and registered without a manual list", (t) => {
  const root = directory(t);
  writeManifest(root, resource("api_3"));
  mkdirSync(join(root, "unregistered"));
  const destination = join(root, "compiled", "registry.json");
  assert.equal(packageResources(root, destination).tools.length, 1);
  writeManifest(root, resource("api_4"));
  assert.deepEqual(packageResources(root, destination).tools.map((tool) => tool.name), ["call_api_3", "call_api_4"]);
  assert.deepEqual(loadRegistry(destination).tools.map((tool) => tool.name), ["call_api_3", "call_api_4"]);
});
test("prepared manufacturing DB manifests match the seed View projections and synthetic join identifiers", () => {
  const registry = loadRegistry(fileURLToPath(new URL("../dist/resources/registry.json", import.meta.url)));
  const seeds = new Map<string, string>();
  for (const resource of registry.manifests) {
    if (resource.type !== "postgres") continue;
    const sql = readFileSync(new URL(`../../external_resources/${resource.id}/init.sql`, import.meta.url), "utf8");
    seeds.set(resource.id, sql);
    for (const tool of resource.tools) {
      const projection = /CREATE VIEW ([a-z_]+\.[a-z_]+) AS\s+SELECT ([a-z_, ]+) FROM (private\.[a-z_]+);/.exec(sql);
      assert.ok(projection, "Seed must declare the read-only View explicitly");
      assert.equal(projection[1], tool.operation.view);
      assert.deepEqual(projection[2].split(",").map(column => column.trim()), tool.operation.columns);
      assert.ok(sql.includes(`GRANT SELECT ON ${tool.operation.view} TO demo_reader;`));
      assert.ok(!tool.operation.columns.includes("internal_note"));
    }
  }
  assert.equal(seeds.size, 2);
  const assets = [...(seeds.get("db_1") ?? "").matchAll(/^\s*\('(AST-\d+)', '[^']+', '[^']+', '[^']+', '[^']+', '[^']+', '(TEAM-[A-Z]+)'/gm)];
  const changes = [...(seeds.get("db_2") ?? "").matchAll(/^\s*\('(CHG-\d+)', '(AST-\d+)', '(TEAM-[A-Z]+)'/gm)];
  assert.deepEqual(assets.map(row => row[1]), ["AST-001", "AST-002", "AST-003", "AST-004"]);
  assert.equal(changes.length, 4);
  for (const row of changes) assert.ok(assets.some(asset => asset[1] === row[2] && asset[2] === row[3]));
  assert.ok(!changes.some(row => row[2] === "AST-004"), "AST-004 supports the normal empty related-data scenario");
});
test("invalid manifests, schema keywords, IDs, duplicate tools, and routes fail explicitly", (t) => {
  const original = resource();
  assert.throws(() => registerResources([]), /No resource/);
  assert.throws(() => registerResources([{ ...original, version: 2 }]));
  assert.throws(() => registerResources([{ ...original, unexpected: true }]));
  assert.throws(() => registerResources([original, original]), /Duplicate resource/);
  const duplicate = resource("api_4");
  duplicate.tools[0].name = original.tools[0].name;
  assert.throws(() => registerResources([original, duplicate]), /Duplicate tool/);
  assert.throws(() => registerResources([{ ...original, tools: [{ ...original.tools[0], inputSchema: { ...original.tools[0].inputSchema, $ref: "https://example.test/schema" } }] }]));
  assert.throws(() => registerResources([{ ...original, tools: [{ ...original.tools[0], inputSchema: { type: "object", properties: {} } }] }]));
  const root = directory(t);
  writeManifest(root, resource());
  writeFileSync(join(root, "api_3", "resource.json"), "{");
  assert.throws(() => discoverResources(root), /invalid resource JSON/);
  writeFileSync(join(root, "api_3", "resource.json"), JSON.stringify(resource("api_4")));
  assert.throws(() => discoverResources(root), /match directory/);
  writeFileSync(join(root, "actual.json"), JSON.stringify(resource()));
  rmSync(join(root, "api_3", "resource.json"));
  symlinkSync(join(root, "actual.json"), join(root, "api_3", "resource.json"));
  assert.throws(() => discoverResources(root), /regular files/);
});
test("schema compilation rejects unknown input and invalid output; connection settings fail at startup", () => {
  const registered = registerResources([resource()]);
  assert.equal(registered.tools[0].schema.safeParse({ message: "hello" }).success, true);
  assert.equal(registered.tools[0].schema.safeParse({ message: "hello", sql: "SELECT" }).success, false);
  assert.equal(registered.tools[0].output.safeParse({ message: 7 }).success, false);
  assert.equal(registered.tools[0].output.safeParse({ message: "hello", undeclared: true }).success, false);
  assert.throws(() => createAdapters(registered.manifests, env), /TEST_API_URL/);
  for (const value of ["invalid", "file:///tmp/resource", "http://user:secret@example.test"]) {
    assert.throws(() => createAdapters(registered.manifests, { ...env, TEST_API_URL: value }));
  }
});
test("enum membership preserves sibling type, length and nested output constraints", () => {
  const schema = compileSchema({
    type: "object", additionalProperties: false, required: ["value"],
    properties: { value: { type: "string", enum: ["a", "bbb"], minLength: 2, maxLength: 3 } },
  });
  assert.equal(schema.safeParse({ value: "a" }).success, false);
  assert.equal(schema.safeParse({ value: "bbb" }).success, true);
  assert.equal(schema.safeParse({ value: "cccc" }).success, false);
  const numeric = compileSchema({ type: "integer", enum: [1, 2], minimum: 2 });
  assert.equal(numeric.safeParse(1).success, false);
  assert.equal(numeric.safeParse(2).success, true);
  const invalid = resource();
  invalid.tools[0].inputSchema.properties = { value: { type: "integer", enum: [1.5] } };
  invalid.tools[0].inputSchema.required = ["value"];
  assert.throws(() => registerResources([invalid]), /Enum values/);
});
test("HTTP database query decoding respects declared scalar types and leaves MCP schemas strict", () => {
  const definition = {
    type: "object", additionalProperties: false,
    properties: {
      id: { type: "integer" }, amount: { type: "number" },
      active: { type: "boolean" }, empty: { type: "null" }, name: { type: "string" },
    },
  } as const;
  const decoded = decodeQuery(definition, { id: "1", amount: "1.5", active: "false", empty: "null", name: "1" });
  assert.deepEqual(decoded, { id: 1, amount: 1.5, active: false, empty: null, name: "1" });
  assert.equal(compileSchema(definition).safeParse(decoded).success, true);
  assert.equal(compileSchema(definition).safeParse({ id: "1" }).success, false);
  for (const value of [{ id: "" }, { active: "yes" }, { empty: "" }, { id: ["1", "2"] }]) {
    assert.throws(() => decodeQuery(definition, value));
  }
});
test("DB manifests reject unsafe identifiers, undeclared filters and conflicting routes", () => {
  const database = loadRegistry(fileURLToPath(new URL("../dist/resources/registry.json", import.meta.url))).manifests
    .find((item) => item.id === "db_1");
  assert.ok(database?.type === "postgres");
  const view = structuredClone(database);
  view.tools[0].operation.view = "workshop.customer_summary; DROP TABLE customers";
  assert.throws(() => registerResources([view]));
  const columns = structuredClone(database);
  columns.tools[0].operation.orderBy = "undeclared_column";
  assert.throws(() => registerResources([columns]), /order\/filter/);
  const filters = structuredClone(database);
  filters.tools[0].operation.filters = { unexpected: "name" };
  assert.throws(() => registerResources([filters]), /filters must match/);
  const reserved = structuredClone(database);
  reserved.tools[0].operation.path = "/Health/";
  assert.throws(() => registerResources([reserved]), /Conflicting/);
  const duplicate = structuredClone(database);
  duplicate.id = "db_3";
  duplicate.tools[0].name = "list_duplicate_customers";
  assert.throws(() => registerResources([database, duplicate]), /Conflicting/);
});
test("a malformed compiled bundle and missing endpoint fail server startup", (t) => {
  const root = directory(t);
  writeManifest(root, resource());
  const path = join(root, "bundle", "registry.json");
  packageResources(root, path);
  assert.throws(() => createRuntime(env, path), /TEST_API_URL/);
  writeFileSync(path, JSON.stringify({ version: 2, resources: [] }));
  assert.throws(() => createRuntime(env, path), /invalid compiled/);
});
test("a new folder is listed and called through MCP, with token validation and output enforcement", async (t) => {
  const root = directory(t);
  const added = resource();
  writeManifest(root, added);
  const registryPath = join(root, "bundle", "registry.json");
  packageResources(root, registryPath);
  let calls = 0;
  let badOutput = false;
  const target = await listen(t, createServer(async (request, response) => {
    const header = request.headers.authorization;
    assert.ok(typeof header === "string" && header.startsWith("Bearer "));
    const { payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(env.RESOURCE_TOKEN_KEY), {
      algorithms: ["HS256"], issuer: "simplified-sdlc-runtime", audience: "test.api_3", subject: env.APP_CLIENT_ID,
    });
    assert.equal(payload.scope, "message:read");
    const url = new URL(request.url ?? "/", "http://localhost");
    assert.equal(url.pathname, "/data");
    calls++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ message: badOutput ? 7 : url.searchParams.get("message") }));
  }));
  const runtime = createRuntime({ ...env, TEST_API_URL: target }, registryPath);
  t.onTestFinished(() => runtime.close());
  const origin = await listen(t, createServer(runtime.app));
  await withMcp(`${origin}/mcp`, basicCredentials(env.APP_CLIENT_ID, env.APP_CLIENT_SECRET), async (client) => {
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["call_api_3"]);
    const response = await client.callTool({ name: "call_api_3", arguments: { message: "new directory" } });
    assert.notEqual(response.isError, true);
    assert.deepEqual(response.structuredContent, { result: { message: "new directory" } });
    assert.equal((await client.callTool({ name: "call_api_3", arguments: { message: "bad", unknown: true } })).isError, true);
    assert.equal(calls, 1);
    badOutput = true;
    assert.equal((await client.callTool({ name: "call_api_3", arguments: { message: "bad output" } })).isError, true);
  });
  assert.equal((await fetch(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
});
test("HTTP POST forwards JSON inputs and MCP adapters map local to remote tool names", async (t) => {
  const api = resource();
  api.tools[0].operation.method = "POST";
  const endpoint = application();
  endpoint.post("/data", async (req, res) => {
    await resourceToken(req.headers.authorization, env.RESOURCE_TOKEN_KEY, "test.api_3", env.APP_CLIENT_ID, "message:read");
    res.json(req.body);
  });
  endpoint.post("/remote", async (req, res) => {
    await resourceToken(req.headers.authorization, env.RESOURCE_TOKEN_KEY, "test.remote", env.APP_CLIENT_ID, "message:read");
    await serveMcp(req, res, [{
      name: "remote_echo", title: "Remote echo", description: "Echo",
      schema: z.object({ message: z.string() }).strict(),
    }], async (tool, args) => ({ message: args.message }));
  });
  errors(endpoint);
  const origin = await listen(t, createServer(endpoint));
  const remote: ResourceManifest = {
    version: 1, id: "remote", type: "mcp", connection: { urlEnv: "REMOTE_URL" },
    tools: [{
      ...api.tools[0], name: "local_echo", operation: { tool: "remote_echo", resultKey: "result" },
      authorization: { audience: "test.remote", scope: "message:read" },
    }],
  };
  const root = directory(t);
  writeManifest(root, api);
  writeManifest(root, remote);
  const registryPath = join(root, "bundle", "registry.json");
  packageResources(root, registryPath);
  const runtime = createRuntime({ ...env, TEST_API_URL: origin, REMOTE_URL: `${origin}/remote` }, registryPath);
  t.onTestFinished(() => runtime.close());
  const runtimeOrigin = await listen(t, createServer(runtime.app));
  await withMcp(`${runtimeOrigin}/mcp`, basicCredentials(env.APP_CLIENT_ID, env.APP_CLIENT_SECRET), async (client) => {
    for (const name of ["call_api_3", "local_echo"]) {
      const response = await client.callTool({ name, arguments: { message: name } });
      assert.notEqual(response.isError, true);
      assert.deepEqual(response.structuredContent, { result: { message: name } });
    }
  });
});
