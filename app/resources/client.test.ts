import { changeRows, failedTool, fetch } from "../__mocks__/fetch.js";
import { assets, assetDetails, changeBoard, type Change } from "./client.js";

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

test("board excludes completed changes, sorts risk then plan date and counts only incomplete work", async () => {
  const base: Change = { change_id: "later", asset_id: "AST-001", team_id: "TEAM-QUALITY", title: "Later high", status: "approved", risk: "high", planned_date: "2026-11-09" };
  changeRows.mockReturnValue([
    { ...base, change_id: "medium", risk: "medium", status: "requested", planned_date: "2026-11-01" },
    base,
    { ...base, change_id: "done", status: "completed", planned_date: "2026-10-01" },
    { ...base, change_id: "earlier", planned_date: "2026-11-07" },
    { ...base, change_id: "low", risk: "low", planned_date: "2026-11-02" },
  ]);
  const board = await changeBoard("earlier");
  expect(board.changes.data?.map(row => row.change_id)).toEqual(["earlier", "later", "medium", "low"]);
  expect(board.summary).toEqual({ incomplete: 4, high: 2, pending: 1, risks: [
    { risk: "high", count: 2, percent: 50 }, { risk: "medium", count: 1, percent: 25 }, { risk: "low", count: 1, percent: 25 },
  ] });
  expect(board.windows).toEqual({ data: [] });
  const calls = fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(calls.some(call => call.params.name === "list_maintenance_windows" && call.params.arguments.asset_id === "AST-001")).toBe(true);
});

test("board distinguishes empty results from failed changes and keeps independent sections available", async () => {
  const empty = await changeBoard();
  expect(empty.summary).toMatchObject({ incomplete: 0, high: 0, pending: 0 });
  expect(empty.summary?.risks.every(row => row.count === 0 && row.percent === 0)).toBe(true);
  failedTool.mockReturnValue("list_change_requests");
  const failed = await changeBoard();
  expect(failed.changes).toHaveProperty("error");
  expect(failed.summary).toBeUndefined();
  expect(failed.assets.data).toHaveLength(1);
  expect(failed.teams.data).toHaveLength(1);
});

test("selected change still loads maintenance when asset lookup fails, and does not infer a healthy asset", async () => {
  changeRows.mockReturnValue([{ change_id: "selected", asset_id: "AST-001", team_id: "TEAM-QUALITY", title: "Selected", status: "requested", risk: "high", planned_date: "2026-11-07" }]);
  failedTool.mockReturnValue("list_it_assets");
  const board = await changeBoard("selected");
  expect(board.assets).toHaveProperty("error");
  expect(board.windows).toEqual({ data: [] });
  expect(board.teams.data).toHaveLength(1);
  expect(board.summary).toMatchObject({ incomplete: 1, high: 1, pending: 1 });
});

test("board does not count malformed risk, approval status or plan dates as valid work", async () => {
  const base: Change = { change_id: "invalid", asset_id: "AST-001", team_id: "TEAM-QUALITY", title: "Invalid", status: "requested", risk: "high", planned_date: "2026-11-07" };
  for (const invalid of [{ risk: "unknown" }, { status: "unknown" }, { planned_date: "2026-02-30" }]) {
    fetch.mockImplementation(async (_input, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.method === "initialize") return Response.json({ result: { protocolVersion: "2025-03-26" } });
      const result = request.params.name === "list_change_requests" ?
        { change_requests: [{ ...base, ...invalid }] } : { assets: [], teams: [] };
      return Response.json({ result: { structuredContent: { result } } });
    });
    const board = await changeBoard();
    expect(board.changes).toHaveProperty("error");
    expect(board.summary).toBeUndefined();
  }
});
