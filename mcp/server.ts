import { fileURLToPath } from "node:url";
import { application, errors, required, HttpError, errorCode } from "./http/http.js";
import { checkCredentials, signToken, resourceToken } from "./auth/tokens.js";
import { serveMcp } from "./protocol/mcp.js";
import { loadRegistry } from "./resources/registry.js";
import { createAdapters } from "./resources/adapters.js";
import type { RegisteredTool } from "./resources/resource.js";
import { decodeQuery } from "./resources/resource.js";

export function createRuntime(env: NodeJS.ProcessEnv, registryPath = fileURLToPath(new URL("./resources/registry.json", import.meta.url))) {
  const clientId = required(env, "APP_CLIENT_ID");
  const clientSecret = required(env, "APP_CLIENT_SECRET", 32);
  const signingKey = required(env, "RESOURCE_TOKEN_KEY", 32);
  const registry = loadRegistry(registryPath);
  const tools = new Map(registry.tools.map((tool) => [tool.name, tool]));
  const adapters = createAdapters(registry.manifests, env);
  const app = application();

  async function execute(tool: RegisteredTool, value: unknown, token: string) {
    const parsed = tool.schema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "Invalid resource inputs");
    const adapter = adapters.get(tool.resourceId);
    if (!adapter) throw new Error(`Missing adapter for ${tool.resourceId}`);
    const result = await adapter.call(tool.tool, parsed.data, token);
    const output = tool.output.safeParse(result);
    if (!output.success) throw new HttpError(502, "Resource result does not match its output schema");
    return output.data;
  }

  app.get("/ready", async (req, res) => {
    try {
      await Promise.all([...adapters.values()].map((adapter) => adapter.ready()));
    } catch (error) {
      if (error instanceof Error) {
        console.error(JSON.stringify({ event: "resource_not_ready", code: errorCode(error) }));
        throw new HttpError(503, "Resource not ready");
      }
      throw error;
    }
    res.json({ status: "ready" });
  });
  app.post("/mcp", async (req, res) => {
    checkCredentials(req.headers.authorization, clientId, clientSecret);
    await serveMcp(req, res, registry.tools, async (definition, args) => {
      const tool = tools.get(definition.name);
      if (!tool) throw new HttpError(403, "Resource not permitted");
      const authorization = tool.tool.authorization;
      const token = await signToken(signingKey, "simplified-sdlc-runtime", authorization.audience, clientId, { scope: authorization.scope });
      const result = await execute(tool, args, token);
      console.log(JSON.stringify({
        event: "resource_called", time: new Date().toISOString(), app: clientId,
        resource: tool.resourceId, operation: tool.name, result: "ok",
      }));
      return result;
    });
  });
  for (const tool of registry.tools) {
    if (tool.resource.type !== "postgres" || !("path" in tool.tool.operation)) continue;
    app.get(tool.tool.operation.path, async (req, res) => {
      const authorization = tool.tool.authorization;
      const header = req.headers.authorization;
      await resourceToken(header, signingKey, authorization.audience, clientId, authorization.scope);
      if (typeof header !== "string") throw new HttpError(401, "Resource token required");
      let input: Record<string, unknown>;
      try {
        input = decodeQuery(tool.tool.inputSchema, req.query);
      } catch (error) {
        if (error instanceof Error) throw new HttpError(400, "Invalid resource query");
        throw error;
      }
      res.json(await execute(tool, input, header.slice(7)));
    });
  }

  errors(app);
  return {
    app,
    close: async () => { await Promise.all([...adapters.values()].map((adapter) => adapter.close())); },
  };
}
