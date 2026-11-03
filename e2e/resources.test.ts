import assert from "node:assert/strict";
import { test } from "node:test";

function object(value: unknown): Record<string, unknown> {
  assert.ok(isObject(value), "Expected a JSON object");
  return value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

test("an authenticated MCP client discovers and reads the real prepared API and DB resources", { timeout: 20000 }, async () => {
  const clientId = process.env.APP_CLIENT_ID;
  const secret = process.env.APP_CLIENT_SECRET;
  assert.ok(clientId && secret, "Run just setup before E2E");
  const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3101/mcp";
  let id = 0;
  let protocolVersion: string | undefined;
  async function request(method: string, params: Record<string, unknown>) {
    const requestId = ++id;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, `${method} HTTP request failed`);
    const envelope = object(await response.json());
    assert.equal(envelope.id, requestId);
    assert.equal(envelope.error, undefined, `${method} returned a protocol error`);
    return object(envelope.result);
  }
  const initialization = await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "resource-e2e", version: "1.0.0" },
  });
  const negotiatedVersion = initialization.protocolVersion;
  assert.ok(typeof negotiatedVersion === "string");
  protocolVersion = negotiatedVersion;
  const catalog = await request("tools/list", {});
  assert.ok(Array.isArray(catalog.tools));
  const names = catalog.tools.map((tool: unknown) => object(tool).name);
  for (const name of ["list_it_assets", "list_change_requests", "list_maintenance_windows", "list_responsible_teams"]) {
    assert.ok(names.includes(name), `${name} must be discoverable`);
  }
  async function call(name: string, input: Record<string, string>) {
    const result = await request("tools/call", { name, arguments: input });
    assert.notEqual(result.isError, true, `${name} failed`);
    return object(object(result.structuredContent).result);
  }
  const assets = (await call("list_it_assets", {})).assets;
  const changes = (await call("list_change_requests", {})).change_requests;
  const windows = (await call("list_maintenance_windows", {})).maintenance_windows;
  const teams = (await call("list_responsible_teams", {})).teams;
  assert.ok(Array.isArray(assets) && Array.isArray(changes) && Array.isArray(windows) && Array.isArray(teams));
  assert.deepEqual(assets.map((row: unknown) => object(row).asset_id), ["AST-001", "AST-002", "AST-003", "AST-004"]);
  const assetRows = assets.map(object);
  const teamRows = teams.map(object);
  assert.equal(teams.length, 3);
  assert.equal(changes.length, 4);
  assert.equal(windows.length, 3);
  for (const asset of assetRows) {
    assert.ok(teamRows.some(team => team.team_id === asset.team_id));
    assert.equal("internal_note" in asset, false);
  }
  for (const row of changes.map(object)) {
    assert.ok(assetRows.some(asset => asset.asset_id === row.asset_id && asset.team_id === row.team_id));
  }
  for (const row of windows.map(object)) {
    assert.ok(assetRows.some(asset => asset.asset_id === row.asset_id));
    assert.ok(Date.parse(String(row.start)) < Date.parse(String(row.end)));
  }
  const selected = await call("list_it_assets", { asset_id: "AST-001" });
  assert.deepEqual(selected.assets, [assets[0]]);
  assert.equal(object(assets[0]).name, "가상 품질분석 시스템");
  assert.deepEqual((await call("list_responsible_teams", { team_id: String(object(assets[0]).team_id) })).teams, [teams[0]]);
  assert.equal(((await call("list_change_requests", { asset_id: "AST-001" })).change_requests as unknown[]).length, 2);
  assert.deepEqual((await call("list_maintenance_windows", { asset_id: "AST-001" })).maintenance_windows, [windows[0]]);
  assert.deepEqual((await call("list_change_requests", { asset_id: "AST-004" })).change_requests, []);
  assert.deepEqual((await call("list_maintenance_windows", { asset_id: "AST-004" })).maintenance_windows, []);
  assert.deepEqual((await call("list_it_assets", { status: "retired" })).assets, []);
  assert.deepEqual((await call("list_it_assets", { asset_id: "missing" })).assets, []);
  assert.deepEqual((await call("list_change_requests", { asset_id: "AST-001", status: "approved" })).change_requests, []);
  for (const [name, input] of [
    ["list_it_assets", { sql: "SELECT * FROM private.it_assets" }],
    ["list_change_requests", { status: "invalid" }],
    ["list_maintenance_windows", { asset_id: "" }],
    ["list_responsible_teams", { url: "https://example.com" }],
  ] as const) {
    assert.equal((await request("tools/call", { name, arguments: input })).isError, true);
  }
});
