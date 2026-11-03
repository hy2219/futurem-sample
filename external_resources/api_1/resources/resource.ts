import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = z.object({
  version: z.literal(1), type: z.literal("http"),
  tools: z.array(z.object({
    name: z.string(), title: z.string(), description: z.string(),
    authorization: z.object({ audience: z.string(), scope: z.string() }),
    operation: z.object({ method: z.literal("GET"), path: z.string() }),
    inputSchema: z.record(z.string(), z.unknown()),
  }).passthrough()).length(1),
}).passthrough().parse(JSON.parse(readFileSync(resolve("resource.json"), "utf8")));
const tool = manifest.tools[0];
const schema = z.fromJSONSchema(tool.inputSchema);
if (!(schema instanceof z.ZodObject)) throw new Error("API tool input must be an object schema");
export const inputs = schema;
export const definition = {
  name: tool.name, title: tool.title, description: tool.description,
  audience: tool.authorization.audience, scope: tool.authorization.scope,
  path: tool.operation.path,
  schema: inputs,
};

export const data = [
  { window_id: "MW-001", asset_id: "AST-001", start: "2026-11-07T01:00:00+09:00", end: "2026-11-07T02:00:00+09:00", impact: "품질 분석 조회 일시 중단", status: "scheduled" },
  { window_id: "MW-002", asset_id: "AST-002", start: "2026-11-08T02:00:00+09:00", end: "2026-11-08T03:00:00+09:00", impact: "생산 실적 집계 지연", status: "scheduled" },
  { window_id: "MW-003", asset_id: "AST-003", start: "2026-11-09T01:00:00+09:00", end: "2026-11-09T01:30:00+09:00", impact: "가상 창고 입출고 조회 일시 중단", status: "scheduled" },
];

export function query(value: z.output<typeof inputs>) {
  return { maintenance_windows: data.filter((item) => !value.asset_id || item.asset_id === value.asset_id) };
}
