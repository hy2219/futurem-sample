import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeEnvironment } from "./__mocks__/server.js";

const mainPath = fileURLToPath(new URL("./dist/main.js", import.meta.url));
const validEnv = {
  ...process.env,
  ...makeEnvironment(),
  PORT: "8080",
};

function assertStartupFailure(env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [mainPath], { env, encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "Mock SSO startup failed: check APP_CLIENT_ID, SSO_SESSION_KEY, and PORT");
  assert.ok(!result.stderr.includes(validEnv.SSO_SESSION_KEY));
}

test("main rejects invalid ports and exits without starting a server", () => {
  for (const PORT of ["", "not-a-port", "0", "-1", "1.5", "65536"]) {
    assertStartupFailure({ ...validEnv, PORT });
  }
});

test("main exits safely when required SSO configuration is missing or invalid", () => {
  assertStartupFailure({ ...validEnv, APP_CLIENT_ID: undefined });
  assertStartupFailure({ ...validEnv, SSO_SESSION_KEY: undefined });
  assertStartupFailure({ ...validEnv, SSO_SESSION_KEY: "x".repeat(31) });
});
