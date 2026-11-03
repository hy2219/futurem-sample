import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageResources } from "./registry.js";

const directory = process.env.RESOURCE_SOURCE_DIR ?? resolve("../external_resources");
const destination = fileURLToPath(new URL("../resources/registry.json", import.meta.url));
const registry = packageResources(directory, destination);
console.log(`Registered ${registry.manifests.length} resources and ${registry.tools.length} MCP tools.`);
