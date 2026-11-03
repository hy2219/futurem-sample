import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("resource build entrypoint fails on an absent source instead of producing an empty bundle", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/resources/build-resources.js", import.meta.url))], {
    env: { ...process.env, RESOURCE_SOURCE_DIR: fileURLToPath(new URL("./missing-resource-fixture", import.meta.url)) },
    encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(result.stdout, /Registered/);
});
