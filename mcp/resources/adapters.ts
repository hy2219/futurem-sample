import pg from "pg";
import { z } from "zod";
import { HttpError, requestJson, required, errorCode } from "../http/http.js";
import { withMcp } from "../protocol/mcp.js";
import { resourceToken } from "../auth/tokens.js";
import type { ResourceManifest, ResourceTool, ResourceAdapter } from "./resource.js";

function webUrl(value: string, name: string) {
  if (!URL.canParse(value)) throw new Error(`${name}: invalid connection URL`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name}: expected an HTTP(S) URL without credentials, query or fragment`);
  }
  return url;
}
function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  throw new HttpError(400, "Query and database filter inputs must be scalar values");
}
const quoted = (name: string) => `"${name}"`;

export function createAdapters(resources: readonly ResourceManifest[], env: NodeJS.ProcessEnv): Map<string, ResourceAdapter> {
  const clientId = required(env, "APP_CLIENT_ID");
  const key = required(env, "RESOURCE_TOKEN_KEY", 32);
  const settings = resources.map((resource) => {
    const value = required(env, resource.connection.urlEnv);
    if (resource.type === "postgres") {
      if (!URL.canParse(value)) throw new Error(`${resource.id}: invalid PostgreSQL URL`);
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`${resource.id}: expected a PostgreSQL URL`);
      return { resource, value };
    }
    webUrl(value, resource.connection.urlEnv);
    return { resource, value };
  });
  const adapters = new Map<string, ResourceAdapter>();
  for (const { resource, value } of settings) {
    if (resource.type === "http") {
      const origin = webUrl(value, resource.connection.urlEnv);
      adapters.set(resource.id, {
        async call(tool, input, token) {
          if (!("path" in tool.operation) || !("method" in tool.operation)) throw new Error("Invalid HTTP operation");
          const url = new URL(tool.operation.path, origin);
          if (url.origin !== origin.origin) throw new Error("Resource operation changed the configured origin");
          const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
          const options: RequestInit = { method: tool.operation.method, headers, redirect: "error" };
          if (tool.operation.method === "GET") {
            for (const [name, item] of Object.entries(input)) url.searchParams.set(name, scalar(item));
          } else {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(input);
          }
          return requestJson(url.href, options);
        },
        async ready() {}, async close() {},
      });
    } else if (resource.type === "mcp") {
      adapters.set(resource.id, {
        async call(tool, input, token) {
          if (!("tool" in tool.operation)) throw new Error("Invalid MCP operation");
          const remoteTool = tool.operation.tool;
          const resultKey = tool.operation.resultKey;
          return withMcp(value, `Bearer ${token}`, async (client) => {
            const result = await client.callTool({ name: remoteTool, arguments: input });
            const content = z.record(z.string(), z.unknown()).safeParse(result.structuredContent);
            if (result.isError || !content.success) {
              throw new HttpError(502, "Remote MCP returned an invalid result");
            }
            if (resultKey === undefined) return content.data;
            if (!Object.hasOwn(content.data, resultKey)) throw new HttpError(502, "Remote MCP result key is missing");
            return content.data[resultKey];
          });
        },
        async ready() {}, async close() {},
      });
    } else {
      const databaseResource = resource;
      const pool = new pg.Pool({ connectionString: value, max: 4, connectionTimeoutMillis: 3000, query_timeout: 5000 });
      pool.on("error", (error) => console.error(JSON.stringify({
        event: "database_connection_failed", resource: resource.id, code: errorCode(error),
      })));
      async function ready() {
        for (const tool of databaseResource.tools) {
          const [schema, view] = tool.operation.view.split(".");
          const result = await pool.query<{ table_type: string }>(
            "SELECT table_type FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2", [schema, view],
          );
          if (result.rows[0]?.table_type !== "VIEW") throw new Error(`${resource.id}: configured relation must be an accessible View`);
        }
      }
      adapters.set(resource.id, {
        async call(tool, input, token) {
          if (!("view" in tool.operation)) throw new Error("Invalid PostgreSQL operation");
          await resourceToken(`Bearer ${token}`, key, tool.authorization.audience, clientId, tool.authorization.scope);
          await ready();
          const operation = tool.operation;
          const parameters: unknown[] = [];
          const filters: string[] = [];
          for (const [name, column] of Object.entries(operation.filters)) {
            if (input[name] === undefined) continue;
            const item = input[name];
            scalar(item);
            parameters.push(item);
            filters.push(`${quoted(column)} IS NOT DISTINCT FROM $${parameters.length}`);
          }
          const view = operation.view.split(".").map(quoted).join(".");
          parameters.push(operation.limit);
          const sql = `SELECT ${operation.columns.map(quoted).join(", ")} FROM ${view}` +
            (filters.length ? ` WHERE ${filters.join(" AND ")}` : "") +
            ` ORDER BY ${quoted(operation.orderBy)} LIMIT $${parameters.length}`;
          const result = await pool.query<Record<string, unknown>>(sql, parameters);
          return { [operation.resultKey]: result.rows };
        },
        ready, close: () => pool.end(),
      });
    }
  }
  return adapters;
}
