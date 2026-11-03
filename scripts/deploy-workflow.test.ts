import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Next standalone image preserves the caller runtime mode before the framework forces production", () => {
  const dockerfile = readFileSync("app/Dockerfile", "utf8");
  assert.match(dockerfile, /\/app\/\.next\/standalone/);
  assert.match(dockerfile, /\/app\/\.next\/static/);
  assert.ok(dockerfile.includes('APP_RUNTIME_NODE_ENV=\\"$NODE_ENV\\" exec node server.js'));
  assert.doesNotMatch(dockerfile, /dist\/main\.js/);
});

test("Actions only updates images and never runs infrastructure or transports application secrets", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const workflow of [deploy, ci]) {
    assert.doesNotMatch(workflow, /setup-terraform|terraform\s+-chdir|TF_VAR_|TF_STATE_|ARM_USE_OIDC|DEPLOY_RUNNER_LABELS/);
  }
  assert.doesNotMatch(deploy, /secrets\.|az\s+containerapp\s+(create|secret)|az\s+storage\s/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /azure\/login@v2/);
  assert.match(deploy, /runs-on: ubuntu-latest/);
  assert.match(deploy, /az containerapp update/);
  assert.match(deploy, /--image "\$ACR_SERVER\/\$repository:\$IMAGE_TAG"/);
  assert.match(deploy, /ACR_LOGIN_SERVER/);
  assert.ok(deploy.indexOf("Build and push immutable image") < deploy.indexOf("Update only images"));
  assert.match(deploy, /needs: verify/);
});

test("CD builds seven images in a bounded matrix after full CI and deploys only after every push succeeds", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  const verify = workflow.split("\n  verify:")[1]?.split("\n  build:")[0] ?? "";
  const build = workflow.split("\n  build:")[1]?.split("\n  deploy:")[0] ?? "";
  const deploy = workflow.split("\n  deploy:")[1] ?? "";
  assert.match(verify, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(verify, /id-token/);
  assert.match(build, /needs: verify/);
  assert.match(deploy, /needs: \[verify, build\]/);
  for (const job of [build, deploy]) {
    assert.match(job, /if: github\.ref == 'refs\/heads\/main' && vars\.DEPLOY_REPOSITORY == github\.repository/);
    assert.match(job, /environment: demo/);
    assert.match(job, /id-token: write/);
    assert.match(job, /IMAGE_TAG: \$\{\{ github\.sha \}\}/);
    assert.match(job, /actual=.*az acr show/);
    assert.match(job, /test "\$actual" = "\$ACR_SERVER"/);
    assert.doesNotMatch(job, /always\(\)|continue-on-error/);
  }
  assert.match(build, /max-parallel: 3/);
  assert.match(build, /fail-fast: false/);
  const images = [...build.matchAll(/- repository: ([\w-]+)\s+context: (\S+)\s+dockerfile: (\S+)/g)]
    .map(([, repository, context, dockerfile]) => ({ repository, context, dockerfile }));
  assert.deepEqual(images, [
    { repository: "external-resources", context: ".", dockerfile: "mcp/Dockerfile" },
    { repository: "mock-sso", context: "sso", dockerfile: "sso/Dockerfile" },
    { repository: "api-1", context: "external_resources/api_1", dockerfile: "external_resources/api_1/Dockerfile" },
    { repository: "api-2", context: "external_resources/api_2", dockerfile: "external_resources/api_2/Dockerfile" },
    { repository: "db-1", context: "external_resources/db_1", dockerfile: "external_resources/db_1/Dockerfile" },
    { repository: "db-2", context: "external_resources/db_2", dockerfile: "external_resources/db_2/Dockerfile" },
    { repository: "business-app", context: "app", dockerfile: "app/Dockerfile" },
  ]);
  assert.match(build, /if: matrix\.repository != 'business-app' \|\| github\.event_name == 'push' \|\| inputs\.deploy_app/);
  assert.ok(build.indexOf('test "$actual" = "$ACR_SERVER"') < build.indexOf("az acr login"));
  assert.ok(build.indexOf("az acr login") < build.indexOf("docker build"));
  assert.match(build, /docker build -f "\$DOCKERFILE" -t "\$ACR_SERVER\/\$REPOSITORY:\$IMAGE_TAG" "\$CONTEXT"/);
  assert.match(build, /docker push "\$ACR_SERVER\/\$REPOSITORY:\$IMAGE_TAG"/);
  assert.doesNotMatch(build, /az containerapp update/);
  assert.doesNotMatch(deploy, /docker build|docker push|az acr login/);
});

test("image CD can read registry metadata with registry-scoped Reader, without infrastructure write access", () => {
  const infra = readFileSync("infra/main.tf", "utf8");
  assert.match(infra, /resource "azurerm_role_assignment" "image_read" \{[^}]*scope\s*=\s*azurerm_container_registry\.workshop\.id[^}]*role_definition_name\s*=\s*"Reader"[^}]*principal_id\s*=\s*var\.deployment_principal_object_id/);
});

test("manual resource-only CD leaves the app matrix job successful by skipping its steps, not the job", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  const build = workflow.split("\n  build:")[1]?.split("\n  deploy:")[0] ?? "";
  const [job, steps = ""] = build.split("\n    steps:");
  assert.doesNotMatch(job, /inputs\.deploy_app/);
  const entries = steps.split("\n      - ").slice(1);
  assert.equal(entries.length, 5);
  for (const step of entries) {
    assert.match(step, /\n        if: matrix\.repository != 'business-app' \|\| github\.event_name == 'push' \|\| inputs\.deploy_app\n/);
  }
});

test("database TCP ingress does not set the HTTP-only insecure option", () => {
  const infra = readFileSync("infra/main.tf", "utf8");
  const database = infra.split('resource "azurerm_container_app" "database"')[1]?.split('resource "azurerm_container_app" "service"')[0];
  const ingress = database?.match(/ingress\s*\{([\s\S]*?)traffic_weight/)?.[1] ?? "";
  assert.match(ingress, /transport\s*=\s*"tcp"/);
  assert.doesNotMatch(ingress, /allow_insecure_connections\s*=\s*true/);
});

test("PRs targeting main run a required full-CI gate and main merges trigger image CD", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(ci, /pull_request:\s*\n\s+branches: \[main\]/);
  assert.doesNotMatch(ci.split("permissions:")[0], /\n\s+push:/);
  assert.match(ci, /\n  ci:\s*\n\s+name: ci\s*\n\s+if: always\(\)\s*\n\s+needs: \[unit, integration\]/);
  assert.match(ci, /NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(ci, /result !== 'success'/);
  assert.match(deploy, /push:\s*\n\s+branches: \[main\]/);
  assert.match(deploy, /DEPLOY_APP: \$\{\{ github\.event_name == 'push' \|\| inputs\.deploy_app \}\}/);
  assert.match(deploy, /if: github\.event_name == 'push' \|\| inputs\.deploy_app/);
  assert.doesNotMatch(deploy, /pull_request_target|pull_request:/);
});

test("the required ci gate fails for a failed, cancelled or skipped prerequisite", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const script = ci.match(/node <<'JS'\n([\s\S]*?)\n\s+JS/)?.[1];
  assert.ok(script);
  for (const result of ["success", "failure", "cancelled", "skipped"]) {
    const run: SpawnSyncReturns<string> = spawnSync("node", ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, NEEDS: JSON.stringify({
        unit: { result }, integration: { result: "success" },
      }) },
    });
    assert.equal(run.status, result === "success" ? 0 : 1);
  }
});

test("CI accepts runtime global function mocks but still rejects unmatched modules and missing unit tests", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const script = ci.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)?.[1];
  assert.ok(script);
  const directory = mkdtempSync(join(tmpdir(), "sdlc-ci-mocks-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(directory, "main.ts"), "export const value = 1;");
    writeFileSync(join(directory, "main.test.ts"), 'test("value", () => expect(1).toBe(1));');
    mkdirSync(join(directory, "__mocks__"));
    const check = () => {
      return spawnSync("node", ["--input-type=module", "-e", script], {
        cwd: directory,
        encoding: "utf8",
      });
    };
    for (const name of ["fetch", "setTimeout", "missingResource", "toString"]) {
      const mock = join(directory, "__mocks__", `${name}.ts`);
      writeFileSync(mock, "export {};");
      const run = check();
      const supported = name === "fetch" || name === "setTimeout";
      assert.equal(run.status, supported ? 0 : 1, run.stderr);
      if (!supported) assert.match(run.stderr, /Mock path must mirror an implementation or declared package/);
      rmSync(mock);
    }
    writeFileSync(join(directory, "__mocks__", "fetch.ts"), "export {};");
    writeFileSync(join(directory, "main.ts"), 'import "./__mocks__/fetch";');
    const runtimeImport = check();
    assert.equal(runtimeImport.status, 1);
    assert.match(runtimeImport.stderr, /Runtime implementations must not import test doubles/);
    writeFileSync(join(directory, "main.ts"), "export const value = 1;");
    rmSync(join(directory, "main.test.ts"));
    const missingTest = check();
    assert.equal(missingTest.status, 1);
    assert.match(missingTest.stderr, /Missing colocated unit test: main.test.ts/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CI installs the locked Playwright Chromium and system dependencies before browser E2E", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const integration = ci.split("\n  integration:")[1]?.split("\n  ci:")[0] ?? "";
  const install = integration.indexOf("run: bun run playwright install --with-deps chromium");
  assert.ok(install > integration.indexOf("run: just install"), "Install Chromium from the locked root Playwright dependency");
  assert.ok(integration.indexOf("run: just e2e") > install, "Install Chromium before browser E2E");
});
