import { readdirSync, readFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { manifestSchema, compileTool } from "./resource.js";
import type { RegisteredTool, ResourceManifest } from "./resource.js";

function checkDepth(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error("Resource definitions must not exceed 20 nesting levels");
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) checkDepth(child, depth + 1);
  }
}

export function readDefinition(path: string): unknown {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
    throw new Error(`${path}: resource definitions must be regular files no larger than 1 MB`);
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${path}: invalid resource JSON`, { cause: error });
    throw error;
  }
  checkDepth(value);
  return value;
}

export function registerResources(values: readonly unknown[]): { manifests: ResourceManifest[]; tools: RegisteredTool[] } {
  const manifests = values.map((value) => manifestSchema.parse(value));
  if (manifests.length === 0) throw new Error("No resource.json definitions were found");
  const ids = new Set<string>();
  const names = new Set<string>();
  const routes = new Set<string>();
  const tools: RegisteredTool[] = [];
  for (const resource of manifests) {
    if (ids.has(resource.id)) throw new Error(`Duplicate resource id: ${resource.id}`);
    ids.add(resource.id);
    for (const tool of resource.tools) {
      if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      names.add(tool.name);
      if (resource.type === "postgres" && "path" in tool.operation) {
        const route = tool.operation.path.toLowerCase().replace(/\/+$/, "") || "/";
        if (["/mcp", "/health", "/ready", "/favicon.ico"].includes(route) || routes.has(route)) {
          throw new Error(`Conflicting DB adapter route: ${tool.operation.path}`);
        }
        routes.add(route);
      }
      tools.push(compileTool(resource, tool));
    }
  }
  return { manifests, tools };
}

export function discoverResources(directory: string) {
  const values: unknown[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, "resource.json");
    if (!existsSync(path)) continue;
    const value = manifestSchema.parse(readDefinition(path));
    if (value.id !== entry.name) throw new Error(`${path}: resource id must match directory name`);
    values.push(value);
  }
  return registerResources(values);
}

export function loadRegistry(path: string) {
  const value = readDefinition(path);
  if (typeof value !== "object" || value === null || !("version" in value) ||
    value.version !== 1 || !("resources" in value) || !Array.isArray(value.resources)) {
    throw new Error(`${path}: invalid compiled resource registry`);
  }
  return registerResources(value.resources);
}

export function packageResources(source: string, destination: string) {
  const registry = discoverResources(source);
  const content = JSON.stringify({ version: 1, resources: registry.manifests }, null, 2) + "\n";
  if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Compiled registry must not exceed 1 MB");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
  return registry;
}
