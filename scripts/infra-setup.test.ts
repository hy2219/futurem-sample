import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cloud, config, ids, resetCloud, silenceConsole } from "./__mocks__/infra-setup.js";
import { setup, secretNames } from "./infra-setup.js";

vi.mock("node:child_process", () => import("./__mocks__/infra-setup.js"));
let root: string;
const path = (name: string): string => resolve(root, "infra", name);
const read = (name: string): string => readFileSync(path(name), "utf8");
const writeConfig = (value: unknown): void => writeFileSync(path("setup.local.json"), JSON.stringify(value));
const run = (): void => setup(undefined, root);
const mutations = (): string[] => cloud.calls.filter(call =>
  call.args.some(arg => ["create", "set", "PUT", "POST", "post", "apply", "build"].includes(arg))).map(call => call.args.join(" "));
const tfCommands = (): string[] => cloud.calls.filter(call => call.command === "terraform").map(call => call.args.slice(1).join(" "));
const save = (name: string, value: unknown): void => writeFileSync(path(name), JSON.stringify(value), { mode: 0o600 });
beforeEach(() => {
  root = resolve("scripts/test_utils", `infra-fixture-${process.pid}-${crypto.randomUUID()}`);
  mkdirSync(path("."), { recursive: true });
  resetCloud(root);
  vi.stubEnv("ARM_SUBSCRIPTION_ID", "");
  vi.stubEnv("ARM_TENANT_ID", "");
  writeConfig(config);
  silenceConsole();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("read-only target and authentication checks", () => {
  it("uses scoped role listing without the incompatible subscription-wide --all flag", () => {
    run();
    const listing = cloud.calls.find(call => call.command === "az"
      && call.args.slice(0, 3).join(" ") === "role assignment list");
    expect(listing?.args).toContain("--scope");
    expect(listing?.args).toContain("--include-inherited");
    expect(listing?.args).not.toContain("--all");
  });
  it.each([
    ["subscriptionId", "bad"], ["repository", "owner/.."], ["repository", "owner/repo/other"],
    ["resourceGroup", "--bad"], ["resourcePrefix", "Upper"], ["location", "bad region"],
    ["deploymentClientId", "bad"], ["unexpected", "field"], ["constructor", "bad"],
    ["initializeFreshEnvironment", "true"],
  ])("rejects invalid %s before CLI calls", (field, value) => {
    writeConfig({ ...config, [field]: value });
    expect(run).toThrow(/config field/);
    expect(cloud.calls).toEqual([]);
  });
  it.each(["stateStorageAccount", "stateContainer"])("rejects legacy %s with actionable preservation guidance", field => {
    writeConfig({ ...config, [field]: "legacy" });
    expect(run).toThrow(/Back up old Blob\/bootstrap state unchanged/);
    expect(cloud.calls).toEqual([]);
  });
  it.each([["gh", "auth status", "gh auth login"], ["az", "account show", "az login"]])(
    "reports %s authentication failures without captured secrets", (command, prefix, guidance) => {
      cloud.failure = { command, prefix, stderr: "private secret contents" };
      expect(run).toThrow(guidance);
      expect(mutations()).toEqual([]);
    });
  it("refuses a different selected subscription, tenant overrides, disabled account and missing admin permission", () => {
    cloud.account.id = ids.app;
    expect(run).toThrow(`az account set --subscription ${config.subscriptionId}`);
    cloud.account.id = ids.subscription;
    vi.stubEnv("ARM_TENANT_ID", ids.app);
    expect(run).toThrow(/ARM_TENANT_ID conflicts/);
    vi.stubEnv("ARM_TENANT_ID", "");
    cloud.account.state = "Disabled";
    expect(run).toThrow(/enabled/);
    cloud.account.state = "Enabled";
    cloud.admin = false;
    expect(run).toThrow(/admin permission/);
    expect(mutations()).toEqual([]);
  });
  it("requires Network but not Storage, and never automatically registers providers", () => {
    expect(cloud.providers.map(item => item.namespace)).not.toContain("Microsoft.Storage");
    expect(cloud.providers.map(item => item.namespace)).toContain("Microsoft.Network");
    cloud.providers[0].registrationState = "NotRegistered";
    expect(run).toThrow(/will not change provider policy/);
    expect(mutations()).toEqual([]);
  });
  it("refuses a different existing target variable but ignores obsolete state/runner variables", () => {
    cloud.variables.AZURE_RESOURCE_GROUP = "other";
    expect(run).toThrow(/refusing to retarget/);
    expect(mutations()).toEqual([]);
    delete cloud.variables.AZURE_RESOURCE_GROUP;
    cloud.variables.TF_STATE_STORAGE_ACCOUNT = "preserved-old-state";
    cloud.variables.RUNNER_LABEL = "preserved";
    run();
    expect(cloud.variables.TF_STATE_STORAGE_ACCOUNT).toBe("preserved-old-state");
    expect(cloud.variables.RUNNER_LABEL).toBe("preserved");
  });
  it.each([1, 6])("refuses %s legacy GitHub secret names without local credentials, never reads values or rotates", count => {
    for (const name of secretNames.slice(0, count)) cloud.secrets[name] = `old-${name}`;
    expect(run).toThrow(/Restore its private backup/);
    expect(mutations()).toEqual([]);
    expect(existsSync(path("deployment.auto.tfvars.json"))).toBe(false);
    expect(Object.keys(cloud.secrets)).toHaveLength(count);
  });
  it("allows explicitly reviewed fresh initialization beside unused legacy GitHub secrets only in an undeployed environment", () => {
    writeConfig({ ...config, initializeFreshEnvironment: true });
    for (const name of secretNames) cloud.secrets[name] = `old-${name}`;
    const previousSecrets = { ...cloud.secrets };
    cloud.groups = [{ name: config.resourceGroup, tags: { repository: config.repository } }];
    run();
    const vars = JSON.parse(read("deployment.auto.tfvars.json")) as Record<string, unknown>;
    for (const name of secretNames) expect(vars[name.toLowerCase()]).not.toBe(previousSecrets[name]);
    expect(cloud.secrets).toEqual(previousSecrets);
    expect(cloud.calls.filter(call => call.args[0] === "secret").map(call => call.args[1])).toEqual(["list"]);
    expect(cloud.state).toHaveLength(32);
  });
});

describe("local-only complete environment creation", () => {
  it("enforces a no-bypass PR-only main ruleset before creating Azure resources", () => {
    run();
    const policy = cloud.calls.find(call => call.command === "gh"
      && call.args[1] === `repos/${config.repository}/rulesets` && call.args.includes("POST"));
    expect(policy).toBeDefined();
    expect(JSON.parse(policy?.input ?? "{}")).toMatchObject({
      name: "simplified-sdlc-main", target: "branch", enforcement: "active", bypass_actors: [],
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      rules: expect.arrayContaining([
        { type: "deletion" }, { type: "non_fast_forward" },
        expect.objectContaining({ type: "pull_request" }),
        { type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: "ci", integration_id: 15368 }],
        } },
      ]),
    });
    const creation = cloud.calls.findIndex(call => call.command === "az" && call.args.includes("create"));
    expect(cloud.calls.findIndex(call => call === policy)).toBeLessThan(creation);
  });
  it("stops before Azure writes when private repository protection is unsupported", () => {
    cloud.failure = { command: "gh", prefix: `api repos/${config.repository}/rulesets` };
    expect(run).toThrow(/protection is NOT confirmed/);
    expect(cloud.calls.filter(call => call.command === "az").some(call =>
      call.args.some(arg => ["create", "post", "build"].includes(arg)))).toBe(false);
    expect(cloud.state).toEqual([]);
  });
  it("persists six private credentials before cloud writes, foundations then all seven images then apps", () => {
    cloud.beforeMutation = () => {
      expect(statSync(path("deployment.auto.tfvars.json")).mode & 0o777).toBe(0o600);
      const vars = JSON.parse(read("deployment.auto.tfvars.json")) as Record<string, unknown>;
      for (const name of secretNames) expect(vars[name.toLowerCase()]).toBeTruthy();
    };
    run();
    const vars = JSON.parse(read("deployment.auto.tfvars.json")) as Record<string, unknown>;
    expect(vars).toMatchObject({
      resource_group_name: config.resourceGroup, resource_prefix: config.resourcePrefix, location: "koreacentral",
      subscription_id: ids.subscription, tenant_id: ids.tenant, enable_apps: true, enable_business_app: true,
      image_tag: ids.head, deployment_principal_object_id: ids.principal,
    });
    expect(vars.app_client_id).toMatch(/^[a-f0-9-]{36}$/);
    for (const name of secretNames.slice(1)) expect(vars[name.toLowerCase()]).toMatch(/^[a-f0-9]{64}$/);
    const calls = cloud.calls.map(call => `${call.command} ${call.args.join(" ")}`);
    const foundation = calls.findIndex(line => line.includes("-var=enable_apps=false"));
    const builds = cloud.calls.flatMap((call, index) => call.command === "node" ? [index] : []);
    const finalPlan = calls.findIndex(line => line.includes("-var=enable_apps=true"));
    expect(foundation).toBeGreaterThan(0);
    expect(builds).toHaveLength(1);
    expect(builds[0]).toBeGreaterThan(foundation);
    expect(finalPlan).toBeGreaterThan(builds.at(-1) ?? -1);
    expect(cloud.calls[builds[0]].args).toEqual([
      resolve(root, "scripts/build-images.ts"), config.subscriptionId, "workshopacr123456", ids.head, root,
    ]);
    expect(cloud.state).toHaveLength(32);
    expect(tfCommands().filter(line => line.startsWith("apply "))).toEqual([
      "apply -input=false .state/deployment.tfplan", "apply -input=false .state/deployment.tfplan",
    ]);
    expect(statSync(path(".state/terraform.tfstate")).mode & 0o777).toBe(0o600);
    expect(statSync(path(".state")).mode & 0o777).toBe(0o700);
    expect(calls.join("\n")).not.toMatch(/-auto-approve|-reconfigure|-migrate-state|storage |secret set|secret delete|credential reset|password|account set|import /);
    for (const name of secretNames) expect(calls.join("\n")).not.toContain(String(vars[name.toLowerCase()]));
    expect(cloud.variables).toEqual({
      AZURE_CLIENT_ID: ids.app, AZURE_TENANT_ID: ids.tenant, AZURE_SUBSCRIPTION_ID: ids.subscription,
      AZURE_RESOURCE_GROUP: config.resourceGroup, DEPLOY_REPOSITORY: config.repository,
      ACR_NAME: "workshopacr123456", ACR_LOGIN_SERVER: "workshopacr123456.azurecr.io",
    });
    expect(cloud.assignments).toHaveLength(1);
    expect(cloud.calls.find(call => call.args.slice(0, 3).join(" ") === "role assignment create")?.args)
      .toContain("Container Apps Contributor");
  });
  it("uses actual immutable GitHub subject without a client password", () => {
    run();
    expect(cloud.federations).toEqual([{
      name: "github-demo-main", issuer: "https://token.actions.githubusercontent.com",
      subject: "repo:98765/123456:environment:demo", audiences: ["api://AzureADTokenExchange"],
    }]);
    expect(cloud.calls.map(call => call.args.join(" ")).join("\n")).not.toMatch(/credential reset|client-secret|create-for-rbac/);
  });
  it("repeats with unchanged credentials/state and no image rebuild, foundation disable, identity or variable rewrites", () => {
    run();
    cloud.seedDemo();
    const reviewers = structuredClone(cloud.demo);
    const vars = read("deployment.auto.tfvars.json");
    for (const name of secretNames) cloud.secrets[name] = "untouched-legacy";
    cloud.calls = [];
    run();
    expect(read("deployment.auto.tfvars.json")).toBe(vars);
    expect(cloud.state).toHaveLength(32);
    expect(cloud.apps).toHaveLength(1);
    expect(cloud.demo).toEqual(reviewers);
    expect(mutations().filter(line => !line.includes(" apply "))).toEqual([]);
    expect(tfCommands()).not.toContain(expect.stringContaining("enable_apps=false"));
    expect(cloud.calls.some(call => call.args[0] === "secret")).toBe(false);
    expect(cloud.calls.some(call => call.command === "node")).toBe(false);
  });
  it("stops after any image failure, preserves foundation and credentials, then resumes safely", () => {
    cloud.failure = { command: "node", prefix: resolve(root, "scripts/build-images.ts"), stderr: "private-data" };
    expect(run).toThrow(/Image builds failed; inspect ACR Tasks/);
    expect(cloud.state).toHaveLength(25);
    expect(tfCommands().filter(line => line.startsWith("apply "))).toHaveLength(1);
    expect(tfCommands().some(line => line.includes("enable_apps=true"))).toBe(false);
    expect(cloud.variables).toEqual({});
    expect(cloud.calls.some(call => call.command === "gh" && call.args[0] === "variable" && call.args[1] === "set")).toBe(false);
    const vars = read("deployment.auto.tfvars.json");
    cloud.failure = undefined;
    cloud.calls = [];
    run();
    expect(read("deployment.auto.tfvars.json")).toBe(vars);
    expect(tfCommands().some(line => line.includes("enable_apps=false"))).toBe(false);
    expect(cloud.state).toHaveLength(32);
  });
  it("preserves ignored old bootstrap artifacts, Blob config and local .env byte-for-byte", () => {
    mkdirSync(path("bootstrap/.state"), { recursive: true });
    const old = [
      ["bootstrap/.state/terraform.tfstate", "old-bootstrap-state"],
      ["bootstrap/bootstrap.local.tfvars.json", "old-bootstrap-vars"],
      ["backend.local.hcl", "old-remote-backend"],
    ];
    for (const [file, text] of old) writeFileSync(path(file), text);
    writeFileSync(resolve(root, ".env"), "APP_CLIENT_SECRET=local-only");
    run();
    for (const [file, text] of old) expect(read(file)).toBe(text);
    expect(readFileSync(resolve(root, ".env"), "utf8")).toBe("APP_CLIENT_SECRET=local-only");
  });
});

describe("state and credential fail-closed guards", () => {
  it("refuses the legacy non-VNet environment before any cloud mutation or image build", () => {
    run();
    const environment = cloud.state.find(item => item.address === "azurerm_container_app_environment.workshop");
    expect(environment).toBeDefined();
    if (!environment) throw new Error("Missing prepared environment");
    delete environment.values.infrastructure_subnet_id;
    cloud.saveState();
    cloud.calls = [];
    expect(run).toThrow(/Legacy single-environment/);
    expect(mutations()).toEqual([]);
  });
  it.each(["azurerm", "s3"])("refuses previous %s backend metadata before any command", type => {
    mkdirSync(path(".terraform"), { mode: 0o700 });
    save(".terraform/terraform.tfstate", { backend: { type, config: { path: ".state/terraform.tfstate" } } });
    const before = read(".terraform/terraform.tfstate");
    expect(run).toThrow(type === "azurerm" ? /Previous Azure backend/ : /Unexpected cached backend/);
    expect(cloud.calls).toEqual([]);
    expect(read(".terraform/terraform.tfstate")).toBe(before);
  });
  it("refuses cached local state with an unexpected path", () => {
    mkdirSync(path(".terraform"), { mode: 0o700 });
    save(".terraform/terraform.tfstate", { backend: { type: "local", config: { path: "other.tfstate" } } });
    expect(run).toThrow(/local state path/);
    expect(cloud.calls).toEqual([]);
  });
  it("accepts the pinned local backend metadata", () => {
    mkdirSync(path(".terraform"), { mode: 0o700 });
    save(".terraform/terraform.tfstate", { backend: { type: "local", config: { path: ".state/terraform.tfstate" } } });
    run();
    expect(tfCommands()[0]).toBe("init -input=false -lockfile=readonly");
  });
  it.each(["Microsoft.ContainerRegistry/registries", "Microsoft.App/containerApps", "Microsoft.App/managedEnvironments",
    "Microsoft.Network/virtualNetworks", "Microsoft.Network/networkSecurityGroups", "Microsoft.Network/privateDnsZones"])(
    "refuses missing local state when owned RG already contains %s", type => {
      cloud.groups = [{ name: config.resourceGroup, tags: { repository: config.repository } }];
      cloud.resources = [{ id: "/existing", type }];
      expect(run).toThrow(/already exist without matching local state/);
      expect(mutations()).toEqual([]);
      expect(existsSync(path("deployment.auto.tfvars.json"))).toBe(false);
    });
  it("never lets explicit fresh approval rotate credentials for existing cloud apps or nonempty state", () => {
    writeConfig({ ...config, initializeFreshEnvironment: true });
    for (const name of secretNames) cloud.secrets[name] = `old-${name}`;
    cloud.groups = [{ name: config.resourceGroup, tags: { repository: config.repository } }];
    cloud.resources = [{ id: "/existing/app", type: "Microsoft.App/containerApps" }];
    expect(run).toThrow(/already exist without matching local state/);
    expect(mutations()).toEqual([]);
    expect(existsSync(path("deployment.auto.tfvars.json"))).toBe(false);
    cloud.resources = [];
    run();
    rmSync(path("deployment.auto.tfvars.json"));
    cloud.calls = [];
    expect(run).toThrow(/Restore the matching private backup/);
    expect(cloud.calls).toEqual([]);
  });
  it("refuses malformed state and missing state with a backup, never falls back", () => {
    mkdirSync(path(".state"), { mode: 0o700 });
    writeFileSync(path(".state/terraform.tfstate"), "{bad", { mode: 0o600 });
    expect(run).toThrow(/Invalid JSON/);
    rmSync(path(".state/terraform.tfstate"));
    save(".state/terraform.tfstate.backup", { version: 4, resources: [] });
    expect(run).toThrow(/backup exists/);
    expect(cloud.calls).toEqual([]);
  });
  it("refuses existing state whose local credentials are missing", () => {
    run();
    rmSync(path("deployment.auto.tfvars.json"));
    cloud.calls = [];
    expect(run).toThrow(/Restore the matching private backup/);
    expect(cloud.calls).toEqual([]);
  });
  it("refuses a state read failure before any cloud writes", () => {
    cloud.failure = { command: "terraform", prefix: "show -json" };
    expect(run).toThrow(/terraform .* failed/);
    expect(mutations()).toEqual([]);
  });
  it("refuses nonempty state with no registry and preserves all credentials", () => {
    run();
    const vars = read("deployment.auto.tfvars.json");
    cloud.state = cloud.state.filter(item => item.address !== "azurerm_container_registry.workshop");
    cloud.saveState();
    cloud.calls = [];
    expect(run).toThrow(/Existing state has no registry/);
    expect(mutations()).toEqual([]);
    expect(read("deployment.auto.tfvars.json")).toBe(vars);
  });
  it.each([{ actions: ["delete"] }, { actions: ["delete", "create"] }])("rejects destructive plan actions $actions before apply", ({ actions }) => {
    cloud.planChanges = [{ address: "azurerm_container_registry.workshop", mode: "managed", change: { actions } }];
    expect(run).toThrow(/Plan contains deletion/);
    expect(tfCommands().some(line => line.startsWith("apply "))).toBe(false);
  });
  it("rejects an unexpected plan address", () => {
    cloud.planChanges = [{ address: "azurerm_storage_account.legacy", mode: "managed", change: { actions: ["create"] } }];
    expect(run).toThrow(/unexpected resources/);
    expect(tfCommands().some(line => line.startsWith("apply "))).toBe(false);
  });
  it("refuses registry output loss without building or disabling apps", () => {
    run();
    cloud.outputs = {};
    cloud.calls = [];
    expect(run).toThrow(/registry outputs are missing/);
    expect(mutations()).toEqual([]);
    expect(tfCommands().some(line => line.includes("enable_apps=false"))).toBe(false);
  });
  it("refuses different pinned subscription/identity/secret values without rewriting credentials", () => {
    run();
    const original = JSON.parse(read("deployment.auto.tfvars.json")) as Record<string, unknown>;
    for (const [key, value] of [["subscription_id", ids.tenant], ["deployment_principal_object_id", ids.app], ["postgres_password", "bad"]]) {
      const altered = { ...original, [key]: value };
      save("deployment.auto.tfvars.json", altered);
      cloud.calls = [];
      expect(run).toThrow(/different|differs|invalid POSTGRES_PASSWORD/);
      expect(mutations()).toEqual([]);
      expect(JSON.parse(read("deployment.auto.tfvars.json"))).toEqual(altered);
    }
  });
  it("refuses permissive or symlinked private credentials", () => {
    run();
    chmodSync(path("deployment.auto.tfvars.json"), 0o644);
    expect(run).toThrow(/mode 0600/);
    rmSync(path("deployment.auto.tfvars.json"));
    symlinkSync(path("setup.local.json"), path("deployment.auto.tfvars.json"));
    expect(run).toThrow(/not symlinks/);
  });
});

describe("existing identity and trust ownership", () => {
  it("refuses an unowned name-matched identity and a conflicting existing federation", () => {
    cloud.seedIdentity();
    cloud.apps[0].tags = [];
    expect(run).toThrow(/not repository-owned/);
    cloud.apps[0].tags = [`repository:${config.repository}`];
    cloud.federations = [{
      name: "github-demo-main", issuer: "https://token.actions.githubusercontent.com",
      subject: "repo:other/repo:environment:demo", audiences: ["api://AzureADTokenExchange"],
    }];
    expect(run).toThrow(/refusing to replace trust/);
    expect(mutations()).toEqual([]);
  });
  it("allows an explicitly reviewed deployment identity", () => {
    cloud.seedIdentity();
    cloud.apps[0].tags = [];
    writeConfig({ ...config, deploymentClientId: ids.app });
    run();
    expect(cloud.apps).toHaveLength(1);
  });
  it("uses the non-immutable default only when the repository reports it", () => {
    cloud.oidc = { use_default: true };
    run();
    expect(cloud.federations[0].subject).toBe("repo:example/workshop:environment:demo");
  });
  it("refuses an absent actual immutable subject and custom subject templates", () => {
    cloud.oidc = { use_default: true, use_immutable_subject: true };
    expect(run).toThrow(/actual immutable/);
    cloud.oidc = { use_default: false };
    expect(run).toThrow(/Custom GitHub OIDC/);
    expect(mutations()).toEqual([]);
  });
  it("never weakens existing environment protection or branch policy", () => {
    cloud.seedDemo();
    cloud.branchPolicies.push({ name: "feature", type: "branch" });
    expect(run).toThrow(/allow only main/);
    expect(mutations()).toEqual([]);
  });
  it("warns but never deletes existing broad deployment roles", () => {
    cloud.seedIdentity();
    cloud.assignments.push({ principalId: ids.principal, scope: `/subscriptions/${ids.subscription}`,
      roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c" });
    run();
    expect(cloud.assignments).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("broader deployment roles were preserved"));
    expect(cloud.calls.some(call => call.args.includes("delete"))).toBe(false);
  });
  it("matches exact RG scopes rather than accepting an inherited Container Apps role as the local assignment", () => {
    cloud.seedIdentity();
    cloud.assignments.push({
      principalId: ids.principal, scope: `/subscriptions/${ids.subscription}`,
      roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/358470bc-b998-42bd-ab17-a7e34c199c0f",
    });
    run();
    expect(cloud.assignments).toHaveLength(2);
    expect(cloud.assignments[1].scope).toBe(`/subscriptions/${ids.subscription}/resourceGroups/${config.resourceGroup}`);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("broader deployment roles were preserved"));
    cloud.calls = [];
    run();
    expect(cloud.calls.some(call => call.args.slice(0, 3).join(" ") === "role assignment create")).toBe(false);
  });
});
