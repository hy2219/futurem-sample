import { z } from "zod";
import type { ToolDefinition } from "../protocol/mcp.js";

export type SchemaDefinition = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, SchemaDefinition>;
  required?: string[];
  additionalProperties?: false;
  items?: SchemaDefinition;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

const field = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .refine((name) => !["__proto__", "prototype", "constructor"].includes(name), "Reserved field name");
const identifier = z.string().regex(/^[a-z][a-z0-9_]*$/);
const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const route = z.string().regex(/^\/[A-Za-z0-9_/-]*$/).refine((value) => !value.startsWith("//"), "Use a local path");
const nonempty = z.string().min(1).max(500);

const schemaDefinition: z.ZodType<SchemaDefinition> = z.lazy(() => z.object({
  type: z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]),
  description: z.string().optional(),
  properties: z.record(field, schemaDefinition).optional(),
  required: z.array(field).optional(),
  additionalProperties: z.literal(false).optional(),
  items: schemaDefinition.optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
}).strict().superRefine((schema, context) => {
  if (schema.type === "object") {
    if (!schema.properties || schema.additionalProperties !== false) {
      context.addIssue({ code: "custom", message: "Object schemas require properties and additionalProperties: false" });
    }
    for (const name of schema.required ?? []) {
      if (!schema.properties || !(name in schema.properties)) {
        context.addIssue({ code: "custom", message: `Required field ${name} has no schema` });
      }
    }
  } else if (schema.properties || schema.required || schema.additionalProperties !== undefined) {
    context.addIssue({ code: "custom", message: "Object keywords require type: object" });
  }
  if (schema.type === "array" && !schema.items) {
    context.addIssue({ code: "custom", message: "Array schemas require items" });
  } else if (schema.type !== "array" && (schema.items || schema.minItems !== undefined || schema.maxItems !== undefined)) {
    context.addIssue({ code: "custom", message: "Array keywords require type: array" });
  }
  if (schema.type !== "string" && (schema.minLength !== undefined || schema.maxLength !== undefined)) {
    context.addIssue({ code: "custom", message: "Length constraints require type: string" });
  }
  if (!["number", "integer"].includes(schema.type) && (schema.minimum !== undefined || schema.maximum !== undefined)) {
    context.addIssue({ code: "custom", message: "Numeric constraints require a numeric type" });
  }
  if (schema.enum?.some((value) =>
    schema.type === "null" ? value !== null :
      schema.type === "integer" ? typeof value !== "number" || !Number.isInteger(value) :
        ["object", "array"].includes(schema.type) || typeof value !== schema.type)) {
    context.addIssue({ code: "custom", message: "Enum values must match the declared scalar type" });
  }
  for (const [min, max] of [[schema.minimum, schema.maximum], [schema.minLength, schema.maxLength], [schema.minItems, schema.maxItems]]) {
    if (min !== undefined && max !== undefined && min > max) {
      context.addIssue({ code: "custom", message: "Minimum must not exceed maximum" });
    }
  }
}));

const authorization = z.object({
  audience: nonempty,
  scope: nonempty,
}).strict();
const toolMetadata = {
  name: identifier,
  title: nonempty,
  description: nonempty,
  inputSchema: schemaDefinition.refine((schema) => schema.type === "object", "Tool input must be an object"),
  outputSchema: schemaDefinition,
  authorization,
};
const httpOperation = z.object({
  method: z.enum(["GET", "POST"]),
  path: route,
}).strict();
const postgresOperation = z.object({
  path: route,
  view: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/),
  columns: z.array(field).min(1),
  filters: z.record(field, field).default({}),
  orderBy: field,
  resultKey: field,
  limit: z.number().int().min(1).max(1000).default(100),
}).strict();
const mcpOperation = z.object({ tool: identifier, resultKey: field.optional() }).strict();
const header = { version: z.literal(1), id: identifier };

export const manifestSchema = z.discriminatedUnion("type", [
  z.object({
    ...header, type: z.literal("http"), connection: z.object({ urlEnv: environmentName }).strict(),
    tools: z.array(z.object({ ...toolMetadata, operation: httpOperation }).strict()).min(1),
  }).strict(),
  z.object({
    ...header, type: z.literal("postgres"), connection: z.object({ urlEnv: environmentName }).strict(),
    tools: z.array(z.object({ ...toolMetadata, operation: postgresOperation }).strict()).min(1),
  }).strict(),
  z.object({
    ...header, type: z.literal("mcp"), connection: z.object({ urlEnv: environmentName }).strict(),
    tools: z.array(z.object({ ...toolMetadata, operation: mcpOperation }).strict()).min(1),
  }).strict(),
]);

export type ResourceManifest = z.infer<typeof manifestSchema>;
export type ResourceTool = ResourceManifest["tools"][number];
export interface RegisteredTool extends ToolDefinition {
  resourceId: string;
  resource: ResourceManifest;
  tool: ResourceTool;
  output: z.ZodType;
}
export interface ResourceAdapter {
  call(tool: ResourceTool, input: Record<string, unknown>, token: string): Promise<unknown>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function compileSchema(schema: SchemaDefinition): z.ZodType {
  let result: z.ZodType;
  if (schema.type === "object") {
    const shape: Record<string, z.ZodType> = {};
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const value = compileSchema(child);
      shape[name] = schema.required?.includes(name) ? value : value.optional();
    }
    result = z.object(shape).strict();
  } else if (schema.type === "array") {
    if (!schema.items) throw new Error("Array schema is missing its item schema");
    let value = z.array(compileSchema(schema.items));
    if (schema.minItems !== undefined) value = value.min(schema.minItems);
    if (schema.maxItems !== undefined) value = value.max(schema.maxItems);
    result = value;
  } else if (schema.type === "string") {
    let value = z.string();
    if (schema.minLength !== undefined) value = value.min(schema.minLength);
    if (schema.maxLength !== undefined) value = value.max(schema.maxLength);
    result = value;
  } else if (schema.type === "number" || schema.type === "integer") {
    let value = schema.type === "integer" ? z.number().int() : z.number();
    if (schema.minimum !== undefined) value = value.min(schema.minimum);
    if (schema.maximum !== undefined) value = value.max(schema.maximum);
    result = value;
  } else {
    result = schema.type === "boolean" ? z.boolean() : z.null();
  }
  if (schema.enum) result = z.intersection(result, z.union(schema.enum.map((value) => z.literal(value))));
  return schema.description ? result.describe(schema.description) : result;
}

export function decodeQuery(schema: SchemaDefinition, query: unknown): Record<string, unknown> {
  const values = z.record(z.string(), z.string()).safeParse(query);
  if (!values.success) throw new Error("Query values must be individual strings");
  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values.data)) {
    const type = schema.properties?.[name]?.type;
    if (type === "integer" || type === "number") {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(`Invalid numeric query field: ${name}`);
      decoded[name] = Number(value);
    } else if (type === "boolean") {
      if (value !== "true" && value !== "false") throw new Error(`Invalid boolean query field: ${name}`);
      decoded[name] = value === "true";
    } else if (type === "null") {
      if (value !== "null") throw new Error(`Invalid null query field: ${name}`);
      decoded[name] = null;
    } else {
      decoded[name] = value;
    }
  }
  return decoded;
}

export function compileTool(resource: ResourceManifest, tool: ResourceTool): RegisteredTool {
  const input = compileSchema(tool.inputSchema);
  if (!(input instanceof z.ZodObject)) throw new Error(`${tool.name}: tool inputs must compile to an object schema`);
  if (resource.type !== "mcp") {
    const scalarInputsOnly = resource.type === "postgres" || ("method" in tool.operation && tool.operation.method === "GET");
    if (scalarInputsOnly && Object.values(tool.inputSchema.properties ?? {}).some((schema) => ["object", "array"].includes(schema.type))) {
      throw new Error(`${tool.name}: query and database inputs must be scalar schemas`);
    }
  }
  if (resource.type === "postgres" && "view" in tool.operation) {
    const operation = tool.operation;
    if (!operation.columns.includes(operation.orderBy) ||
      Object.values(operation.filters).some((column) => !operation.columns.includes(column)) ||
      Object.keys(operation.filters).some((name) => !tool.inputSchema.properties?.[name])) {
      throw new Error(`${tool.name}: DB order/filter columns must be declared and filters must match input fields`);
    }
    if (Object.keys(tool.inputSchema.properties ?? {}).some((name) => !(name in operation.filters))) {
      throw new Error(`${tool.name}: every DB input must have a filter mapping`);
    }
  }
  return {
    name: tool.name, title: tool.title, description: tool.description,
    schema: input, resourceId: resource.id, resource, tool,
    output: compileSchema(tool.outputSchema),
  };
}
