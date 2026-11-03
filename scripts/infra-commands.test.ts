import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("infra-setup runs only the complete local-state orchestrator", () => {
  const result = spawnSync("just", ["--dry-run", "infra-setup", "infra/setup.local.json"], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const commands = result.stderr.trim().split("\n");
  assert.equal(commands.length, 1);
  assert.match(commands[0] ?? "", /^node scripts\/infra-setup\.ts ['"]?infra\/setup\.local\.json/);
  assert.ok(!result.stderr.includes("-reconfigure"));
  assert.ok(!result.stderr.includes("-migrate-state"));
});

test("infra-update runs only interactive apply against the private variables", () => {
  const result = spawnSync("just", ["--dry-run", "infra-update"], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "terraform -chdir=infra apply -var-file=deployment.auto.tfvars.json");
  assert.ok(!result.stderr.includes("-auto-approve"));
  assert.ok(!result.stderr.includes("init"));
});

test("local setup remains separate from cloud bootstrap", () => {
  const result = spawnSync("just", ["--dry-run", "setup"], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "node scripts/setup.ts");
});

test("native Node can resolve the policy dependency without a compiled scripts directory", () => {
  const result = spawnSync("node", ["scripts/infra-setup.ts", "infra/missing-setup-for-entry-check.json"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  assert.match(result.stderr, /Infrastructure setup failed/);
});
