import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { discoverResources, registerResources } from "./registry.js";

import { makeHttpResource } from "../__mocks__/resources/registry.js";
const resource = makeHttpResource("api");
test("resource stubs are reproducible without sharing mutable Faker state", () => {
  assert.deepEqual(makeHttpResource("api", 7), makeHttpResource("api", 7));
  assert.notDeepEqual(makeHttpResource("api", 7), makeHttpResource("api", 8));
});
test("prepared resources expose standard mock controls and preserve their default factory", () => {
  const original = makeHttpResource("api", 7);
  makeHttpResource.mockClear();
  makeHttpResource.mockImplementation(() => original);
  assert.deepEqual(makeHttpResource("scenario", 8), original);
  assert.deepEqual(makeHttpResource.mock.calls, [["scenario", 8]]);
  makeHttpResource.mockReturnValueOnce(resource);
  assert.deepEqual(makeHttpResource(), resource);
  makeHttpResource.mockReset();
  assert.deepEqual(makeHttpResource("api", 7), original);
  assert.notDeepEqual(makeHttpResource("api", 8), original);
});
test("registry discovers only declared directories and rejects duplicate identities", (t) => {
  const root = mkdtempSync(join(process.cwd(), ".registry-unit-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "api"));
  mkdirSync(join(root, "unregistered"));
  writeFileSync(join(root, "api", "resource.json"), JSON.stringify(resource));
  assert.deepEqual(discoverResources(root).manifests.map((item) => item.id), ["api"]);
  assert.throws(() => registerResources([resource, resource]), /Duplicate resource/);
  assert.throws(() => registerResources([]), /No resource/);
});
