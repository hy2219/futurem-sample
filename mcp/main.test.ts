import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("MCP entrypoint rejects invalid port before starting the server", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./dist/main.js", import.meta.url))], {
    env: { ...process.env, PORT: "invalid" }, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid PORT/);
  assert.doesNotMatch(result.stdout, /listening/);
});
