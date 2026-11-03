import { setting } from "../auth/session";

export type Asset = { asset_id: string; name: string; system_type: string; status: string; team_id: string; site: string; criticality: string };
export type Change = { change_id: string; asset_id: string; team_id: string; title: string; status: "requested" | "approved" | "completed"; risk: "high" | "medium" | "low"; planned_date: string };
export type Maintenance = { window_id: string; asset_id: string; start: string; end: string; impact: string; status: string };
export type Team = { team_id: string; name: string; contact: string; support_hours: string };
export type Section<T> = { data: T[]; error?: never } | { error: string; data?: never };
export type AssetDetail = { asset: Asset; changes: Section<Change>; windows: Section<Maintenance>; teams: Section<Team> };
export type ChangeBoard = {
  changes: Section<Change>; assets: Section<Asset>; teams: Section<Team>; windows?: Section<Maintenance>;
  summary?: { incomplete: number; high: number; pending: number; risks: { risk: Change["risk"]; count: number; percent: number }[] };
};
const fields = {
  assets: ["asset_id", "name", "system_type", "status", "team_id", "site", "criticality"],
  changes: ["change_id", "asset_id", "team_id", "title", "status", "risk", "planned_date"],
  windows: ["window_id", "asset_id", "start", "end", "impact", "status"],
  teams: ["team_id", "name", "contact", "support_hours"],
};

async function section<T>(name: string, args: Record<string, string>, key: string, required: string[], join?: string, value?: string): Promise<Section<T>> {
  try {
    const data = rows<T>(await tool(name, args), key, required);
    if (join && data.some(row => (row as Record<string, unknown>)[join] !== value)) throw new Error("연결 ID가 일치하지 않습니다.");
    return { data };
  } catch {
    return { error: "리소스 조회에 실패했습니다." };
  }
}

export async function changeBoard(id?: string): Promise<ChangeBoard> {
  let [changes, assetRows, teams] = await Promise.all([
    section<Change>("list_change_requests", {}, "change_requests", fields.changes),
    section<Asset>("list_it_assets", {}, "assets", fields.assets),
    section<Team>("list_responsible_teams", {}, "teams", fields.teams),
  ]);
  const risks: Change["risk"][] = ["high", "medium", "low"];
  if (changes.data?.some(row => !risks.includes(row.risk) ||
    !["requested", "approved", "completed"].includes(row.status) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.planned_date) || !Number.isFinite(Date.parse(row.planned_date)) ||
    new Date(row.planned_date).toISOString().slice(0, 10) !== row.planned_date)) {
    changes = { error: "변경 응답의 상태, 위험도 또는 계획일이 올바르지 않습니다." };
  }
  const board: ChangeBoard = { changes, assets: assetRows, teams };
  if (changes.data) {
    const data = changes.data.filter(row => row.status !== "completed")
      .sort((a, b) => risks.indexOf(a.risk) - risks.indexOf(b.risk) || a.planned_date.localeCompare(b.planned_date));
    board.changes = { data };
    board.summary = {
      incomplete: data.length,
      high: data.filter(row => row.risk === "high").length,
      pending: data.filter(row => row.status === "requested").length,
      risks: risks.map(risk => {
        const count = data.filter(row => row.risk === risk).length;
        return { risk, count, percent: data.length ? count / data.length * 100 : 0 };
      }),
    };
    const selected = data.find(row => row.change_id === id);
    if (selected) {
      board.windows = await section<Maintenance>("list_maintenance_windows", { asset_id: selected.asset_id },
        "maintenance_windows", fields.windows, "asset_id", selected.asset_id);
    }
  }
  return board;
}

export async function assetDetails(id: string): Promise<AssetDetail | null> {
  const found = rows<Asset>(await tool("list_it_assets", { asset_id: id }), "assets", fields.assets);
  if (found.length === 0) return null;
  const asset = found[0];
  if (found.length !== 1 || !asset || asset.asset_id !== id) throw new Error("자산 ID 응답이 일치하지 않습니다.");
  const [changes, windows, teams] = await Promise.all([
    section<Change>("list_change_requests", { asset_id: id }, "change_requests", fields.changes, "asset_id", id),
    section<Maintenance>("list_maintenance_windows", { asset_id: id }, "maintenance_windows", fields.windows, "asset_id", id),
    section<Team>("list_responsible_teams", { team_id: asset.team_id }, "teams", fields.teams, "team_id", asset.team_id),
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
  return rows<Asset>(await tool("list_it_assets", status ? { status } : {}), "assets", fields.assets);
}
