import assert from "node:assert/strict";
import { compileSchema, decodeQuery, manifestSchema } from "./resource.js";

test("resource schemas keep enum, type and bounds together", () => {
  const text = compileSchema({ type: "string", enum: ["a", "bbb"], minLength: 2 });
  assert.equal(text.safeParse("a").success, false);
  assert.equal(text.safeParse("bbb").success, true);
  const number = compileSchema({ type: "integer", minimum: 2, maximum: 4 });
  assert.equal(number.safeParse(1).success, false);
  assert.equal(number.safeParse(2.5).success, false);
  assert.equal(number.safeParse(3).success, true);
});
test("resource objects reject undeclared fields and decode only declared scalar query types", () => {
  const definition = {
    type: "object", additionalProperties: false,
    properties: { id: { type: "integer" }, active: { type: "boolean" }, missing: { type: "null" } },
  } as const;
  const decoded = decodeQuery(definition, { id: "3", active: "false", missing: "null" });
  assert.deepEqual(decoded, { id: 3, active: false, missing: null });
  const schema = compileSchema(definition);
  assert.equal(schema.safeParse(decoded).success, true);
  assert.equal(schema.safeParse({ id: "3" }).success, false);
  assert.equal(schema.safeParse({ unknown: true }).success, false);
  assert.throws(() => decodeQuery(definition, { id: ["1", "2"] }));
});
test("resource manifest requires its version, typed connection and tool contract", () => {
  assert.equal(manifestSchema.safeParse({ version: 2, id: "unsupported", type: "http" }).success, false);
  assert.equal(manifestSchema.safeParse({ version: 1, id: "empty", type: "http", connection: { urlEnv: "API_URL" }, tools: [] }).success, false);
});
