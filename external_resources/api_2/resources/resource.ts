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
  { team_id: "TEAM-QUALITY", name: "가상 품질정보팀", contact: "quality-demo@example.com", support_hours: "평일 09:00–18:00 KST" },
  { team_id: "TEAM-PRODUCTION", name: "가상 생산정보팀", contact: "production-demo@example.com", support_hours: "평일 09:00–18:00 KST" },
  { team_id: "TEAM-MATERIALS", name: "가상 자재물류팀", contact: "materials-demo@example.com", support_hours: "평일 09:00–18:00 KST" },
];

export function query(value: z.output<typeof inputs>) {
  return { teams: data.filter((item) => !value.team_id || item.team_id === value.team_id) };
}
