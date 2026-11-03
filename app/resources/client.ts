import { setting } from "../auth/session";

export type Asset = { asset_id: string; name: string; system_type: string; status: string; team_id: string; site: string; criticality: string };
export type Change = { change_id: string; asset_id: string; team_id: string; title: string; status: string; risk: string; planned_date: string };
export type Maintenance = { window_id: string; asset_id: string; start: string; end: string; impact: string; status: string };
export type Team = { team_id: string; name: string; contact: string; support_hours: string };
export type Section<T> = { data: T[]; error?: never } | { error: string; data?: never };
export type AssetDetail = { asset: Asset; changes: Section<Change>; windows: Section<Maintenance>; teams: Section<Team> };
export async function assetDetails(id: string): Promise<AssetDetail | null> {
  const found = rows<Asset>(await tool("list_it_assets", { asset_id: id }), "assets",
    ["asset_id", "name", "system_type", "status", "team_id", "site", "criticality"]);
  if (found.length === 0) return null;
  const asset = found[0];
  if (found.length !== 1 || !asset || asset.asset_id !== id) throw new Error("자산 ID 응답이 일치하지 않습니다.");
  async function section<T>(name: string, args: Record<string, string>, key: string, fields: string[], join: string, value: string): Promise<Section<T>> {
    try {
      const data = rows<T>(await tool(name, args), key, fields);
      if (data.some(row => (row as Record<string, unknown>)[join] !== value)) throw new Error("연결 ID가 일치하지 않습니다.");
      return { data };
    } catch {
      return { error: "리소스 조회에 실패했습니다." };
    }
  }
  const [changes, windows, teams] = await Promise.all([
    section<Change>("list_change_requests", { asset_id: id }, "change_requests",
      ["change_id", "asset_id", "team_id", "title", "status", "risk", "planned_date"], "asset_id", id),
    section<Maintenance>("list_maintenance_windows", { asset_id: id }, "maintenance_windows",
      ["window_id", "asset_id", "start", "end", "impact", "status"], "asset_id", id),
    section<Team>("list_responsible_teams", { team_id: asset.team_id }, "teams",
      ["team_id", "name", "contact", "support_hours"], "team_id", asset.team_id),
  ]);
  return { asset, changes, windows, teams };
}

async function tool(name: string, args: Record<string, string>): Promise<unknown> {
  let version: string | undefined;
  let id = 0;
  async function request(method: string, params: Record<string, unknown>) {
    const requestId = ++id;
    const response = await fetch(setting("MCP_URL"), {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${setting("APP_CLIENT_ID")}:${setting("APP_CLIENT_SECRET")}`).toString("base64")}`,
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        ...(version ? { "MCP-Protocol-Version": version } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
    if (!response.ok) throw new Error("리소스 서버 요청에 실패했습니다.");
    const envelope = await response.json();
    if (envelope.error || envelope.result === undefined) throw new Error("리소스 프로토콜 오류입니다.");
    return envelope.result;
  }
  const initialization = await request("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "futurem-app", version: "1.0.0" },
  });
  if (typeof initialization.protocolVersion !== "string") throw new Error("MCP 초기화에 실패했습니다.");
  version = initialization.protocolVersion;
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError || !result.structuredContent?.result) throw new Error("리소스 조회에 실패했습니다.");
  return result.structuredContent.result;
}

function rows<T>(value: unknown, key: string, fields: readonly string[]): T[] {
  if (!value || typeof value !== "object") throw new Error("리소스 응답 형식이 올바르지 않습니다.");
  const result = (value as Record<string, unknown>)[key];
  if (!Array.isArray(result) || result.some(row => !row || typeof row !== "object" ||
    fields.some(field => typeof row[field] !== "string"))) throw new Error("리소스 응답 필드가 올바르지 않습니다.");
  return result as T[];
}

export async function assets(status?: string): Promise<Asset[]> {
  return rows<Asset>(await tool("list_it_assets", status ? { status } : {}), "assets",
    ["asset_id", "name", "system_type", "status", "team_id", "site", "criticality"]);
}
