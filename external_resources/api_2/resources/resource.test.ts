import assert from "node:assert/strict";
import { data, inputs, query } from "./resource.js";

test("api_2 returns fictional responsible teams and supports the owner team join", () => {
  assert.deepEqual(query({}), { teams: data });
  assert.deepEqual(query({ team_id: "TEAM-MATERIALS" }), { teams: [data[2]] });
  assert.deepEqual(query({ team_id: "TEAM-QUALITY" }), { teams: [data[0]] });
  assert.deepEqual(query({ team_id: "TEAM-PRODUCTION" }), { teams: [data[1]] });
  assert.deepEqual(query({ team_id: "missing" }), { teams: [] });
  assert.ok(data.every(team => team.contact.endsWith("@example.com")));
  assert.deepEqual(inputs.parse({}), {});
  assert.deepEqual(inputs.parse({ team_id: "TEAM-QUALITY" }), { team_id: "TEAM-QUALITY" });
  assert.equal(inputs.safeParse({ team_id: "" }).success, false);
  assert.equal(inputs.safeParse({ team_id: ["TEAM-QUALITY"] }).success, false);
  assert.equal(inputs.safeParse({ url: "https://other.example" }).success, false);
});
