import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import pg from "pg";
import { basicCredentials, signToken } from "../auth/tokens.js";
import { withMcp } from "../protocol/mcp.js";
import { required } from "../http/http.js";
import { loadRegistry } from "../resources/registry.js";

const runtimeUrl = process.env.RUNTIME_URL ?? "http://127.0.0.1:3101";
const tools = loadRegistry(fileURLToPath(new URL("../dist/resources/registry.json", import.meta.url))).tools;
const credentials = () => ({
  id: required(process.env, "APP_CLIENT_ID"),
  secret: required(process.env, "APP_CLIENT_SECRET", 32),
  key: required(process.env, "RESOURCE_TOKEN_KEY", 32),
});

test("MCP container loads the compiled resource registry and reports readiness", async () => {
  for (const path of ["/health", "/ready"]) {
    assert.equal((await fetch(`${runtimeUrl}${path}`, { signal: AbortSignal.timeout(5000) })).status, 200);
  }
});
test("MCP rejects incorrect app credentials", async () => {
  const { id, secret } = credentials();
  for (const authorization of ["", basicCredentials(id, "wrong"), basicCredentials("other-app", secret)]) {
    const response = await fetch(`${runtimeUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization }, body: "{}",
    });
    assert.equal(response.status, 401);
  }
});
test("MCP lists manifest tools, publishes their schemas, and calls every adapter", async () => {
  const { id, secret } = credentials();
  await withMcp(`${runtimeUrl}/mcp`, basicCredentials(id, secret), async (client) => {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), tools.map((tool) => tool.name).sort());
    assert.ok(catalog.tools.every((tool) => tool.outputSchema !== undefined));
    assert.ok(!catalog.tools.some((tool) => tool.name === "echo_message"));
    for (const [name, field, expected] of [
      ["list_maintenance_windows", "maintenance_windows", 3], ["list_responsible_teams", "teams", 3],
      ["list_it_assets", "assets", 4], ["list_change_requests", "change_requests", 4],
    ] as const) {
      const response = await client.callTool({ name, arguments: {} });
      assert.notEqual(response.isError, true);
      const payload = z.object({ result: z.record(z.string(), z.array(z.unknown())) }).parse(response.structuredContent);
      assert.equal(payload.result[field].length, expected);
    }
    for (const name of ["list_it_assets", "list_change_requests", "arbitrary_sql"]) {
      assert.equal((await client.callTool({ name, arguments: { sql: "SELECT" } })).isError, true);
    }
  });
});
test("removed demo MCP endpoint is not exposed", async () => {
  const response = await fetch(`${runtimeUrl}/mock/mcp`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 404);
});
for (const [name, port, view, table, otherView, path, audience, scope] of [
  ["DB_1_URL", 15432, "asset_summary", "it_assets", "change_request_summary", "/mock/db/assets", "mock.db", "assets:read"],
  ["DB_2_URL", 15433, "change_request_summary", "change_requests", "asset_summary", "/mock/db/changes", "mock.db_2", "changes:read"],
] as const) {
  test(`${name} exposes only its View and rejects unauthorized adapter calls`, async () => {
    const { id, key } = credentials();
    const url = process.env[name] ??
      `postgresql://demo_reader:${required(process.env, "PG_READER_PASSWORD", 32)}@127.0.0.1:${port}/workshop`;
    const database = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000, query_timeout: 5000 });
    await database.connect();
    try {
      const result = await database.query<Record<string, unknown>>(`SELECT * FROM workshop.${view} ORDER BY 1`);
      assert.equal(result.rows.length, 4);
      assert.ok(result.rows.every((row) => !("internal_note" in row)));
      assert.equal((await database.query("SELECT to_regclass($1) AS relation", [`workshop.${otherView}`])).rows[0].relation, null);
      assert.deepEqual((await database.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0],
        { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
      for (const statement of [
        `SELECT * FROM private.${table}`, `DELETE FROM workshop.${view}`,
        "CREATE TABLE public.forbidden (id integer)", "CREATE TABLE workshop.forbidden (id integer)",
      ]) await assert.rejects(database.query(statement), { code: "42501" });
    } finally { await database.end(); }
    const issue = (aud: string = audience, allowedScope: string = scope, lifetime = 60) =>
      signToken(key, "simplified-sdlc-runtime", aud, id, { scope: allowedScope }, lifetime);
    for (const [token, query, expected] of [
      ["", "", 401], [await issue("mock.api"), "", 401],
      [await issue(audience, "wrong:write"), "", 403], [await issue(audience, scope, -1), "", 401],
      [await issue(), "?sql=SELECT", 400], [await issue(), "", 200],
    ] as const) {
      assert.equal((await fetch(`${runtimeUrl}${path}${query}`, { headers: { Authorization: `Bearer ${token}` } })).status, expected);
    }
  });
}
