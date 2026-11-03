import { failedTool, fetch } from "../__mocks__/fetch.js";
import { assets, assetDetails } from "./client.js";

beforeEach(() => {
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("MCP_URL", "http://unit-mcp/mcp");
  vi.stubEnv("APP_CLIENT_ID", "unit-client");
  vi.stubEnv("APP_CLIENT_SECRET", "unit-secret");
});

test("joins changes and maintenance by asset ID and team by the selected asset team ID", async () => {
  const detail = await assetDetails("AST-001");
  expect(detail).toMatchObject({
    asset: { asset_id: "AST-001" }, changes: { data: [] }, windows: { data: [] },
    teams: { data: [{ team_id: "TEAM-QUALITY" }] },
  });
  const calls = fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))
    .filter(call => call.method === "tools/call").map(call => call.params);
  expect(calls).toContainEqual({ name: "list_it_assets", arguments: { asset_id: "AST-001" } });
  expect(calls).toContainEqual({ name: "list_change_requests", arguments: { asset_id: "AST-001" } });
  expect(calls).toContainEqual({ name: "list_maintenance_windows", arguments: { asset_id: "AST-001" } });
  expect(calls).toContainEqual({ name: "list_responsible_teams", arguments: { team_id: "TEAM-QUALITY" } });
  expect(await assetDetails("missing")).toBeNull();
});

test("preserves successful detail sections and reports a failed resource instead of empty success", async () => {
  failedTool.mockReturnValue("list_change_requests");
  const detail = await assetDetails("AST-001");
  expect(detail?.changes).toHaveProperty("error");
  expect(detail?.changes).not.toHaveProperty("data");
  expect(detail?.windows).toEqual({ data: [] });
  expect(detail?.teams).toMatchObject({ data: [{ team_id: "TEAM-QUALITY" }] });
});
test("reads assets using authenticated server-side MCP and structuredContent.result", async () => {
  expect(await assets()).toMatchObject([{ asset_id: "AST-001", team_id: "TEAM-QUALITY" }]);
  const calls = fetch.mock.calls;
  expect(calls[0]?.[1]?.headers).toHaveProperty("Authorization", `Basic ${Buffer.from("unit-client:unit-secret").toString("base64")}`);
  expect(JSON.parse(String(calls[1]?.[1]?.body)).params).toEqual({ name: "list_it_assets", arguments: {} });
  expect(calls[1]?.[1]?.cache).toBe("no-store");
});
test("never turns resource failures or malformed output into empty success", async () => {
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(assets()).rejects.toThrow();
  fetch.mockResolvedValueOnce(Response.json({ result: { protocolVersion: "2025-03-26" } }));
  fetch.mockResolvedValueOnce(Response.json({ result: { isError: true } }));
  await expect(assets()).rejects.toThrow();
});

test("passes only the selected asset status to MCP", async () => {
  await assets("maintenance");
  const calls = fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(calls[1].params).toEqual({ name: "list_it_assets", arguments: { status: "maintenance" } });
});
