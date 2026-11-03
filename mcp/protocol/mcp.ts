import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { errorCode } from "../http/http.js";

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  output?: z.ZodType;
}

export async function withMcp<T>(url: string, authorization: string, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "simplified-sdlc-app", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: authorization } },
  });
  try {
    await client.connect(transport);
    return await operation(client);
  } finally {
    await client.close();
  }
}

export async function serveMcp(
  req: Request, res: Response, definitions: readonly ToolDefinition[],
  call: (definition: ToolDefinition, args: Record<string, unknown>) => Promise<unknown>,
) {
  const server = new McpServer({ name: "simplified-sdlc", version: "0.1.0" });
  for (const definition of definitions) {
    server.registerTool(definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.schema,
      ...(definition.output ? { outputSchema: z.object({ result: definition.output }) } : {}),
    }, async (args) => {
      const data = await call(definition, args);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { result: data } };
    });
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  res.on("close", () => {
    Promise.all([server.close(), transport.close()]).catch((error) => {
      console.error(JSON.stringify({ event: "mcp_close_failed", code: errorCode(error) }));
    });
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
