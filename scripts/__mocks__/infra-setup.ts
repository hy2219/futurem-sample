import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const ids = {
  subscription: "11111111-1111-4111-8111-111111111111", tenant: "22222222-2222-4222-8222-222222222222",
  app: "33333333-3333-4333-8333-333333333333", appObject: "44444444-4444-4444-8444-444444444444",
  principal: "55555555-5555-4555-8555-555555555555", head: "a".repeat(40),
};
export const config = {
  subscriptionId: ids.subscription, repository: "example/workshop",
  resourceGroup: "workshop-rg", resourcePrefix: "workshop",
};
type Identity = { id: string; appId: string; tags?: string[] };
type Federation = { name: string; subject: string; issuer: string; audiences: string[] };
type Assignment = { principalId: string; scope: string; roleDefinitionId: string };
type Resource = { address: string; mode: string; values: { id: string; name?: string; login_server?: string; infrastructure_subnet_id?: string } };
type PlanChange = { address: string; mode: string; change: { actions: string[] } };
export type Call = { command: string; args: string[]; input?: string };
const foundation = [
  "azurerm_container_registry.workshop", "azurerm_user_assigned_identity.image_pull",
  "azurerm_role_assignment.image_pull", "azurerm_role_assignment.image_push",
  "azurerm_role_assignment.image_read",
  "azurerm_log_analytics_workspace.workshop", "azurerm_container_app_environment.workshop",
  "azurerm_virtual_network.workshop",
  ...["frontend", "mcp", "resources"].flatMap(tier => [
    `azurerm_subnet.tier["${tier}"]`, `azurerm_network_security_group.tier["${tier}"]`,
    `azurerm_subnet_network_security_group_association.tier["${tier}"]`,
  ]),
  ...["mcp", "resources"].flatMap(tier => [
    `azurerm_container_app_environment.backend["${tier}"]`,
    `azurerm_private_dns_zone.backend["${tier}"]`,
    `azurerm_private_dns_a_record.backend["${tier}"]`,
    `azurerm_private_dns_zone_virtual_network_link.backend["${tier}"]`,
  ]),
];
const apps = [
  ...["app", "runtime", "sso", "api_1", "api_2"].map(name => `azurerm_container_app.service["${name}"]`),
  ...["db_1", "db_2"].map(name => `azurerm_container_app.database["${name}"]`),
];
const groupScope = `/subscriptions/${ids.subscription}/resourceGroups/${config.resourceGroup}`;
export class Cloud {
  root = "";
  calls: Call[] = [];
  variables: Record<string, string> = {};
  rulesets: { id: number; name: string; [key: string]: unknown }[] = [];
  secrets: Record<string, string> = {};
  groups: { name: string; tags: { repository: string } }[] = [];
  resources: { id: string; type: string }[] = [];
  apps: Identity[] = [];
  principals: Identity[] = [];
  federations: Federation[] = [];
  assignments: Assignment[] = [];
  demo?: { name: string; protection_rules?: unknown[]; deployment_branch_policy: { protected_branches: boolean; custom_branch_policies: boolean } };
  branchPolicies = [{ name: "main", type: "branch" }];
  head = ids.head;
  admin = true;
  account = { id: ids.subscription, tenantId: ids.tenant, state: "Enabled" };
  providers = ["Microsoft.App", "Microsoft.ContainerRegistry", "Microsoft.OperationalInsights", "Microsoft.ManagedIdentity", "Microsoft.Network"]
    .map(namespace => ({ namespace, registrationState: "Registered" }));
  oidc: { use_default: boolean; use_immutable_subject?: boolean; sub_claim_prefix?: string } = {
    use_default: true, use_immutable_subject: true, sub_claim_prefix: "repo:98765/123456",
  };
  state: Resource[] = [];
  planChanges?: PlanChange[];
  nestedState = false;
  outputs: Record<string, { value: string }> = {
    acr_name: { value: "workshopacr123456" }, acr_login_server: { value: "workshopacr123456.azurecr.io" },
  };
  failure?: { command: string; prefix: string; stderr?: string };
  malformed?: string;
  beforeMutation?: () => void;
  seedIdentity(): void {
    this.apps = [{ id: ids.appObject, appId: ids.app, tags: [`repository:${config.repository}`] }];
    this.principals = [{ id: ids.principal, appId: ids.app }];
  }
  seedDemo(): void {
    this.demo = {
      name: "demo", protection_rules: [{ type: "required_reviewers" }],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    };
  }
  saveState(): void {
    const path = resolve(this.root, "infra/.state/terraform.tfstate");
    if (existsSync(path)) writeFileSync(`${path}.backup`, readFileSync(path), { mode: 0o600 });
    writeFileSync(path, JSON.stringify({ version: 4, serial: 1, resources: this.state }), { mode: 0o600 });
  }
  resource(address: string): Resource {
    const registry = address === foundation[0];
    return { address, mode: "managed", values: {
      id: `${groupScope}/providers/${registry ? "Microsoft.ContainerRegistry/registries/workshopacr123456" : `test/resources/${address.replaceAll(/[^a-zA-Z0-9]/g, "")}`}`,
      ...(registry ? { name: "workshopacr123456", login_server: "workshopacr123456.azurecr.io" } : {}),
      ...(address === "azurerm_container_app_environment.workshop" ? {
        infrastructure_subnet_id: `${groupScope}/providers/Microsoft.Network/virtualNetworks/workshop-vnet/subnets/frontend`,
      } : {}),
    } };
  }
  respond(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
    const input = typeof options.input === "string" ? options.input : undefined;
    this.calls.push({ command, args: [...args], input });
    const line = (command === "terraform" ? args.slice(1) : args).join(" ");
    const result = (stdout: string, status = 0, stderr = ""): SpawnSyncReturns<string> =>
      ({ pid: 123, output: [null, stdout, stderr], stdout, stderr, status, signal: null });
    if (this.failure?.command === command && line.startsWith(this.failure.prefix)) return result("", 1, this.failure.stderr ?? "private output");
    if (this.malformed && line.startsWith(this.malformed)) return result("not json");
    const value = (flag: string): string => args[args.indexOf(flag) + 1];
    if (args.some(arg => ["create", "set", "PUT", "POST", "post", "apply", "build"].includes(arg))) this.beforeMutation?.();
    if (command === "git") return result(this.head);
    if (command === "node" && args[0] === resolve(this.root, "scripts/build-images.ts")) return result("");
    let response: unknown;
    if (command === "terraform") {
      if (args[0] !== `-chdir=${resolve(this.root, "infra")}` || options.env?.TF_WORKSPACE !== "default"
        || options.env?.TF_DATA_DIR !== resolve(this.root, "infra/.terraform") || options.env?.TF_CLI_ARGS !== ""
        || options.env?.[`TF_CLI_ARGS_${args[1]}`] !== "" || process.umask() !== 0o077) throw new Error("Unsafe local Terraform invocation");
      if (line.startsWith("init ")) return result("");
      if (line === "show -json") response = {
        values: { root_module: { resources: this.state, ...(this.nestedState ? { child_modules: [{}] } : {}) } },
      };
      else if (line === "output -json") response = this.outputs;
      else if (line.startsWith("plan ")) {
        const enabled = args.includes("-var=enable_apps=true");
        const addresses = [...foundation, ...(enabled ? apps : [])];
        const changes = this.planChanges ?? addresses.map(address => ({
          address, mode: "managed", change: { actions: [this.state.some(item => item.address === address) ? "no-op" : "create"] },
        }));
        writeFileSync(resolve(this.root, "infra/.state/deployment.tfplan"), JSON.stringify({
          resource_changes: changes, enabled,
        }), { mode: 0o600 });
        return result("");
      } else if (line === "show -json .state/deployment.tfplan") {
        response = JSON.parse(readFileSync(resolve(this.root, "infra/.state/deployment.tfplan"), "utf8"));
      } else if (line.startsWith("apply ")) {
        const plan = JSON.parse(readFileSync(resolve(this.root, "infra/.state/deployment.tfplan"), "utf8")) as { enabled: boolean };
        if ((statSync(resolve(this.root, "infra/deployment.auto.tfvars.json")).mode & 0o777) !== 0o600) throw new Error("Unsafe private variables");
        this.state = [...foundation, ...(plan.enabled ? apps : [])].map(address => this.resource(address));
        this.saveState();
        return result("");
      } else throw new Error(`Unprepared Terraform command: ${line}`);
    } else if (command === "gh") {
      if (line.startsWith("auth status")) return result("");
      if (line.startsWith("variable list")) response = Object.entries(this.variables).map(([name, v]) => ({ name, value: v }));
      else if (line.startsWith("secret list")) response = Object.keys(this.secrets).map(name => ({ name }));
      else if (line.startsWith("variable set")) {
        this.variables[args[2]] = value("--body");
        return result("");
      } else if (args[0] === "api") {
        const path = args[1].replace(`repos/${config.repository}`, "");
        if (!path) response = { id: 123456, full_name: config.repository, permissions: { admin: this.admin } };
        else if (path.startsWith("/rulesets?")) response = [this.rulesets.map(rule => ({ id: rule.id, name: rule.name }))];
        else if (path === "/rulesets" && value("--method") === "POST") {
          const body = JSON.parse(input ?? "{}") as { name: string };
          const created = { ...body, id: this.rulesets.length + 1 };
          this.rulesets.push(created);
          response = created;
        } else if (/^\/rulesets\/\d+$/.test(path)) response = this.rulesets.find(rule => rule.id === Number(path.split("/").at(-1)));
        else if (path === "/actions/oidc/customization/sub") response = this.oidc;
        else if (path === "/environments") response = [{ environments: this.demo ? [this.demo] : [] }];
        else if (path === "/environments/demo" && value("--method") === "PUT") {
          this.demo = {
            name: "demo", deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
          };
          response = this.demo;
        } else if (path === "/environments/demo/deployment-branch-policies") {
          response = args.includes("--method") ? this.branchPolicies[0] : [{ branch_policies: this.branchPolicies }];
        } else throw new Error(`Unprepared gh API path: ${path}`);
      } else throw new Error(`Unprepared gh command: ${line}`);
    } else if (command === "az") {
      if (line.startsWith("account show")) response = this.account;
      else if (line.startsWith("provider list")) response = this.providers;
      else if (line.startsWith("group list")) response = this.groups;
      else if (line.startsWith("resource list")) response = this.resources;
      else if (line.startsWith("group create")) {
        this.groups.push({ name: config.resourceGroup, tags: { repository: config.repository } });
        response = this.groups[0];
      } else if (line.startsWith("ad app list")) response = this.apps;
      else if (line.startsWith("ad app show")) response = this.apps.find(app => app.appId === value("--id"));
      else if (line.startsWith("rest --method post")) {
        const body = JSON.parse(value("--body")) as { tags: string[] };
        this.apps.push({ id: ids.appObject, appId: ids.app, tags: body.tags });
        response = this.apps[0];
      } else if (line.startsWith("ad sp list")) response = this.principals;
      else if (line.startsWith("ad sp create")) {
        this.principals.push({ id: ids.principal, appId: ids.app });
        response = this.principals[0];
      } else if (line.startsWith("ad app federated-credential list")) response = this.federations;
      else if (line.startsWith("ad app federated-credential create")) {
        this.federations.push(JSON.parse(value("--parameters")) as Federation);
        response = this.federations[0];
      } else if (line.startsWith("role assignment list")) response = this.assignments;
      else if (line.startsWith("role assignment create")) {
        this.assignments.push({
          principalId: value("--assignee-object-id"), scope: value("--scope"),
          roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/358470bc-b998-42bd-ab17-a7e34c199c0f",
        });
        response = this.assignments.at(-1);
      }
      else throw new Error(`Unprepared az command: ${line}`);
    } else throw new Error(`Unprepared executable: ${command}`);
    return result(JSON.stringify(response));
  }
}
export let cloud = new Cloud();
export const spawnSync = vi.fn((command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) =>
  cloud.respond(command, args, options));
export function resetCloud(root: string): void {
  cloud = new Cloud();
  cloud.root = root;
  spawnSync.mockClear();
}
export function silenceConsole(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}
