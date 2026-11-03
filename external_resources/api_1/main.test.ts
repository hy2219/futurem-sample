import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApiEnv } from "./__mocks__/server.js";

test("api_1 main rejects invalid ports without starting a server", () => {
  for (const port of ["not-a-port", "0", "-1", "65536", "1.5"]) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./dist/main.js", import.meta.url)),
    ], {
      cwd: new URL("./", import.meta.url),
      env: {
        ...process.env,
        ...createApiEnv(),
        PORT: port,
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "API 1 startup failed: check APP_CLIENT_ID, RESOURCE_TOKEN_KEY and PORT");
  }
});
