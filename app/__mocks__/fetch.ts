import type { Change } from "../resources/client";

export const failedTool = vi.fn<() => string>(() => "");
export const changeRows = vi.fn<() => Change[]>(() => []);
export const fetch = vi.fn<typeof globalThis.fetch>(async (_input, options) => {
  const request = JSON.parse(String(options?.body));
  const name = request.params?.name;
  const data = {
    assets: request.params?.arguments?.asset_id === "missing" ? [] : [{
      asset_id: "AST-001", name: "Unit asset", system_type: "quality-analysis",
      status: "operational", team_id: "TEAM-QUALITY", site: "Unit site", criticality: "high",
    }],
    change_requests: changeRows(),
    maintenance_windows: [],
    teams: [{ team_id: "TEAM-QUALITY", name: "Unit team", contact: "unit@example.com", support_hours: "Unit hours" }],
  };
  const key = {
    list_it_assets: "assets", list_change_requests: "change_requests",
    list_maintenance_windows: "maintenance_windows", list_responsible_teams: "teams",
  }[name as string];
  const result = request.method === "initialize" ? { protocolVersion: "2025-03-26" } : {
    isError: name === failedTool(),
    structuredContent: { result: key ? { [key]: data[key as keyof typeof data] } : {} },
  };
  return Response.json({ jsonrpc: "2.0", id: request.id, result });
});
