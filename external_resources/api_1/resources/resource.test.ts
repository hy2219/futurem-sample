import assert from "node:assert/strict";
import { data, inputs, query } from "./resource.js";

test("api_1 returns fictional maintenance windows joined by stable asset ID", () => {
  assert.deepEqual(query({}), { maintenance_windows: data });
  assert.deepEqual(query({ asset_id: "AST-001" }), { maintenance_windows: [data[0]] });
  assert.deepEqual(query({ asset_id: "AST-002" }), { maintenance_windows: [data[1]] });
  assert.deepEqual(query({ asset_id: "AST-003" }), { maintenance_windows: [data[2]] });
  assert.deepEqual(query({ asset_id: "AST-004" }), { maintenance_windows: [] });
  assert.deepEqual(query({ asset_id: "missing" }), { maintenance_windows: [] });
  assert.ok(data.every(item => Date.parse(item.start) < Date.parse(item.end)));
  assert.deepEqual(inputs.parse({}), {});
  assert.deepEqual(inputs.parse({ asset_id: "AST-001" }), { asset_id: "AST-001" });
  assert.equal(inputs.safeParse({ asset_id: "" }).success, false);
  assert.equal(inputs.safeParse({ asset_id: ["AST-001"] }).success, false);
  assert.equal(inputs.safeParse({ sql: "SELECT" }).success, false);
});
