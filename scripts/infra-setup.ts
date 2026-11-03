import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setupRepository } from "./repository-setup.ts";

type JsonObject = Record<string, unknown>;
type Config = {
  subscriptionId: string; repository: string; resourceGroup: string;
  resourcePrefix: string; location: string; deploymentClientId?: string; initializeFreshEnvironment?: boolean;
};
type Identity = { id: string; appId: string; tags?: string[] };
type Federation = { name: string; issuer: string; subject: string; audiences: string[] };
type StateResource = { address: string; mode: string; values: { id?: string; name?: string; login_server?: string; infrastructure_subnet_id?: string } };
type PlanChange = { address: string; mode: string; change: { actions: string[] } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const secretNames = [
  "APP_CLIENT_ID", "APP_CLIENT_SECRET", "RESOURCE_TOKEN_KEY",
  "SSO_SESSION_KEY", "POSTGRES_PASSWORD", "PG_READER_PASSWORD",
] as const;
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
const appAddresses = [
  ...["app", "runtime", "sso", "api_1", "api_2"].map(name => `azurerm_container_app.service["${name}"]`),
  ...["db_1", "db_2"].map(name => `azurerm_container_app.database["${name}"]`),
];
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): JsonObject {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a JSON object.");
  return value as JsonObject;
}
function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON input or CLI response (content withheld)."); }
}
export function readConfig(path: string): Config {
  const value = object(parse(readFileSync(path, "utf8")));
  requireValue(!Object.hasOwn(value, "stateStorageAccount") && !Object.hasOwn(value, "stateContainer"),
    "Legacy storage setup config is unsupported. Back up old Blob/bootstrap state unchanged, review the local-only migration, and remove stateStorageAccount/stateContainer from a new config; never auto-migrate state.");
  const rules: Record<string, RegExp> = {
    subscriptionId: uuid, deploymentClientId: uuid,
    repository: /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/,
    resourceGroup: /^(?!.*\.$)[A-Za-z0-9_][A-Za-z0-9_().-]{0,89}$/,
    resourcePrefix: /^[a-z][a-z0-9-]{2,17}$/, location: /^[a-z][a-z0-9]{1,39}$/,
  };
  for (const key of Object.keys(value)) requireValue(Object.hasOwn(rules, key) || key === "initializeFreshEnvironment", `Unknown setup config field: ${key}`);
  requireValue(value.initializeFreshEnvironment === undefined || typeof value.initializeFreshEnvironment === "boolean",
    "Invalid setup config field: initializeFreshEnvironment must be a boolean.");
  if (value.location === undefined) value.location = "koreacentral";
  for (const [key, rule] of Object.entries(rules)) {
    if (key === "deploymentClientId" && value[key] === undefined) continue;
    requireValue(typeof value[key] === "string" && rule.test(value[key] as string), `Invalid or missing setup config field: ${key}`);
  }
  return value as Config;
}
function cli(command: string, args: string[], input?: string, guidance?: string, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, {
    encoding: "utf8", input, shell: false, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_HOST: "github.com", AZURE_CORE_COLLECT_TELEMETRY: "false", ...env },
  });
  // CLI errors can echo credentials; never print captured output or full arguments.
  requireValue(!result.error && result.status === 0,
    `${command} ${args.slice(0, command === "az" ? 2 : 1).join(" ")} failed. ${guidance ?? "Check CLI permissions and connectivity; captured output withheld."}`);
  return result.stdout.trim();
}
function localFile(path: string, privateMode = true): string | undefined {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  requireValue(stat.isFile() && !stat.isSymbolicLink(), "Local infrastructure artifacts must be regular files, not symlinks.");
  requireValue(!privateMode || (stat.mode & 0o777) === 0o600, "Local infrastructure artifacts require mode 0600; restore private permissions first.");
  return readFileSync(path, "utf8");
}
function directory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700,
    "Local .state/.terraform must be real directories with mode 0700.");
}
function matchingVariables(actual: Record<string, string>, expected: Record<string, string>): void {
  for (const [name, value] of Object.entries(expected)) requireValue(!actual[name] || actual[name] === value,
    `GitHub variable ${name} targets different infrastructure; refusing to retarget.`);
}

export function setup(configPath = "infra/setup.local.json", root = process.cwd()): void {
  requireValue(process.platform !== "win32", "Run infra-setup in WSL with native Azure/GitHub executables.");
  const config = readConfig(resolve(root, configPath));
  const infra = resolve(root, "infra");
  for (const name of [".state", ".terraform"]) {
    const path = resolve(infra, name);
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), "Local state/data directory cannot be a symlink.");
  }
  const metadata = localFile(resolve(infra, ".terraform/terraform.tfstate"), false);
  if (metadata !== undefined) {
    const backend = object(object(parse(metadata)).backend);
    requireValue(backend.type !== "azurerm",
      "Previous Azure backend detected in infra/.terraform/terraform.tfstate. Stop: back up and review old Blob/bootstrap state outside active Terraform; no automatic reconfigure, migration or deletion is allowed.");
    requireValue(backend.type === "local" && object(backend.config).path === ".state/terraform.tfstate",
      "Unexpected cached backend or local state path; restore the matching local backend metadata.");
  }
  requireValue(!existsSync(resolve(infra, "terraform.tfstate")),
    "Unexpected default-path state exists; preserve it and review manually, not by automatic migration.");
  const statePath = resolve(infra, ".state/terraform.tfstate");
  const rawState = localFile(statePath);
  const backup = localFile(`${statePath}.backup`);
  const stateDocument = rawState === undefined ? undefined : object(parse(rawState));
  if (stateDocument) requireValue(stateDocument.version === 4 && Array.isArray(stateDocument.resources),
    "Invalid local state; restore its private backup, never initialize a replacement.");
  requireValue(!(backup !== undefined && (rawState === undefined || (stateDocument?.resources as unknown[])?.length === 0)),
    "Local state is missing/empty but a backup exists. Restore and review the backup; no replacement state was created.");
  const tfvarsPath = resolve(infra, "deployment.auto.tfvars.json");
  const savedText = localFile(tfvarsPath);
  let saved = savedText === undefined ? undefined : object(parse(savedText));
  requireValue(saved || !stateDocument?.resources || (stateDocument.resources as unknown[]).length === 0,
    "Local deployment variables are missing for existing state. Restore the matching private backup; do not rotate credentials.");
  const az = <T>(args: string[]): T => parse(cli("az", [...args, "--only-show-errors", "--output", "json"])) as T;
  const scoped = <T>(args: string[]): T => az<T>([...args, "--subscription", config.subscriptionId]);
  const gh = <T>(args: string[], input?: string): T => parse(cli("gh", args, input)) as T;
  const api = <T>(path: string, method?: string, body?: unknown): T =>
    gh<T>(["api", `repos/${config.repository}/${path}`, ...(method ? ["--method", method, "--input", "-"] : [])],
      method ? JSON.stringify(body) : undefined);
  const pages = <T>(path: string): T[] => gh<T[]>(["api", `repos/${config.repository}/${path}`, "--paginate", "--slurp"]);
  cli("gh", ["auth", "status", "--hostname", "github.com"], undefined, "Run gh auth login first.");
  const account = parse(cli("az", ["account", "show", "--output", "json", "--only-show-errors"],
    undefined, "Run az login and select the configured subscription first.")) as { id: string; tenantId: string; state: string };
  requireValue(account.id.toLowerCase() === config.subscriptionId.toLowerCase(),
    `Azure CLI selected subscription differs. Run az account set --subscription ${config.subscriptionId} before setup or infra-update.`);
  requireValue(account.state === "Enabled" && uuid.test(account.tenantId), "Azure subscription must be enabled and accessible.");
  for (const [name, expected] of [["ARM_SUBSCRIPTION_ID", config.subscriptionId], ["ARM_TENANT_ID", account.tenantId]]) {
    requireValue(!process.env[name] || process.env[name]?.toLowerCase() === expected.toLowerCase(), `${name} conflicts with the configured Azure target.`);
  }
  const repo = gh<{ id: number; full_name: string; permissions?: { admin: boolean } }>(["api", `repos/${config.repository}`]);
  requireValue(repo.permissions?.admin, "GitHub repository admin permission is required.");
  requireValue(repo.full_name.toLowerCase() === config.repository.toLowerCase() && Number.isSafeInteger(repo.id), "Unexpected GitHub repository identity.");
  config.repository = repo.full_name;
  const variables = Object.fromEntries(gh<{ name: string; value: string }[]>([
    "variable", "list", "--repo", config.repository, "--json", "name,value",
  ]).map(({ name, value }) => [name, value]));
  let legacySecrets = false;
  if (!saved) {
    const names = gh<{ name: string }[]>(["secret", "list", "--repo", config.repository, "--json", "name"]);
    legacySecrets = names.some(item => secretNames.some(name => name === item.name));
  }
  const expectedVars: Record<string, string> = {
    AZURE_TENANT_ID: account.tenantId, AZURE_SUBSCRIPTION_ID: config.subscriptionId,
    AZURE_RESOURCE_GROUP: config.resourceGroup, DEPLOY_REPOSITORY: config.repository,
  };
  matchingVariables(variables, expectedVars);
  const registrations = scoped<{ namespace: string; registrationState: string }[]>(["provider", "list"]);
  for (const provider of ["Microsoft.App", "Microsoft.ContainerRegistry", "Microsoft.OperationalInsights", "Microsoft.ManagedIdentity", "Microsoft.Network"]) {
    requireValue(registrations.some(item => item.namespace === provider && item.registrationState === "Registered"),
      `Required Azure provider ${provider} is not registered; setup will not change provider policy.`);
  }
  const oidc = api<{ use_default: boolean; use_immutable_subject?: boolean; sub_claim_prefix?: string }>("actions/oidc/customization/sub");
  requireValue(oidc.use_default === true, "Custom GitHub OIDC subject templates are unsupported; existing trust was not changed.");
  const subjectPrefix = oidc.use_immutable_subject ? oidc.sub_claim_prefix : `repo:${config.repository}`;
  requireValue(typeof subjectPrefix === "string" && subjectPrefix.length > 0 && !/\s/.test(subjectPrefix),
    "GitHub did not return the actual immutable OIDC subject prefix.");
  const federation: Federation = {
    name: "github-demo-main", issuer: "https://token.actions.githubusercontent.com",
    subject: `${subjectPrefix}:environment:demo`, audiences: ["api://AzureADTokenExchange"],
  };
  const demo = pages<{ environments: { name: string; deployment_branch_policy?: { protected_branches: boolean; custom_branch_policies: boolean } }[] }>("environments")
    .flatMap(page => page.environments).find(item => item.name === "demo");
  if (demo) {
    requireValue(demo.deployment_branch_policy?.protected_branches === false && demo.deployment_branch_policy.custom_branch_policies === true,
      "Existing demo environment must already use custom main-only branch policy; protection rules will not be weakened.");
    const policies = pages<{ branch_policies: { name: string; type: string }[] }>("environments/demo/deployment-branch-policies").flatMap(page => page.branch_policies);
    requireValue(policies.length === 1 && policies[0].name === "main" && policies[0].type === "branch",
      "Existing demo environment must allow only main; policies/reviewers were not changed.");
  }
  const group = scoped<{ name: string; tags?: Record<string, string> }[]>(["group", "list"])
    .find(item => item.name.toLowerCase() === config.resourceGroup.toLowerCase());
  requireValue(!group || group.tags?.repository === config.repository, "Existing resource group lacks this repository's ownership tag.");
  const cloud = group ? scoped<{ id: string; type: string }[]>(["resource", "list", "--resource-group", config.resourceGroup]) : [];
  const explicitClient = config.deploymentClientId || variables.AZURE_CLIENT_ID;
  if (explicitClient) {
    requireValue(uuid.test(explicitClient), "Existing deployment client ID must be a UUID.");
    matchingVariables(variables, { AZURE_CLIENT_ID: explicitClient });
  }
  const displayName = `${config.resourcePrefix}-github-${repo.id}`;
  const ownershipTag = `repository:${config.repository}`;
  const apps = explicitClient ? [az<Identity>(["ad", "app", "show", "--id", explicitClient])]
    : az<Identity[]>(["ad", "app", "list", "--filter", `displayName eq '${displayName}'`, "--all"]);
  requireValue(apps.length <= 1, "Multiple matching Entra applications exist; provide deploymentClientId explicitly.");
  let app = apps[0] as Identity | undefined;
  if (app) {
    requireValue(uuid.test(app.id) && uuid.test(app.appId) && (explicitClient
      ? app.appId.toLowerCase() === explicitClient.toLowerCase() : app.tags?.includes(ownershipTag)),
    "Existing matching Entra application is not repository-owned or has a different identity.");
    matchingVariables(variables, { AZURE_CLIENT_ID: app.appId });
  }
  let principal = app ? az<Identity[]>(["ad", "sp", "list", "--filter", `appId eq '${app.appId}'`, "--all"])[0] : undefined;
  requireValue(!principal || uuid.test(principal.id), "Invalid deployment principal object ID.");
  const credentials = app ? az<Federation[]>(["ad", "app", "federated-credential", "list", "--id", app.id]) : [];
  const existingFederation = credentials.find(item => item.name === federation.name);
  requireValue(!existingFederation || (existingFederation.issuer === federation.issuer && existingFederation.subject === federation.subject
    && existingFederation.audiences.length === 1 && existingFederation.audiences[0] === federation.audiences[0]),
  "Existing github-demo-main federated credential differs; refusing to replace trust.");
  const head = cli("git", ["-C", root, "rev-parse", "HEAD"]);
  requireValue(/^[0-9a-f]{40}$/.test(head), "A full Git HEAD commit SHA is required.");
  const settings = {
    resource_group_name: config.resourceGroup, resource_prefix: config.resourcePrefix, location: config.location,
    subscription_id: config.subscriptionId, tenant_id: account.tenantId, enable_apps: true, enable_business_app: true,
  };
  if (saved) {
    for (const [key, value] of Object.entries(settings)) requireValue(saved[key] === value, `Local deployment file has different ${key}; refusing to overwrite.`);
    requireValue(typeof saved.image_tag === "string" && /^[0-9a-f]{40}$/.test(saved.image_tag), "Invalid saved image tag.");
    requireValue(saved.deployment_principal_object_id === undefined || saved.deployment_principal_object_id === principal?.id,
      "Local deployment principal differs; restore the matching identity and backup.");
    for (const name of secretNames) requireValue(typeof saved[name.toLowerCase()] === "string"
      && (name === "APP_CLIENT_ID" ? uuid : /^[0-9a-f]{64}$/).test(saved[name.toLowerCase()] as string),
    `Local deployment file has invalid ${name}; restore its private backup.`);
    const known = [...Object.keys(settings), "image_tag", "deployment_principal_object_id", ...secretNames.map(name => name.toLowerCase())];
    requireValue(Object.keys(saved).every(key => known.includes(key)), "Unexpected fields in local deployment file.");
  }
  directory(resolve(infra, ".state"));
  // Preserve existing provider caches; only newly created directories get private mode.
  if (!existsSync(resolve(infra, ".terraform"))) directory(resolve(infra, ".terraform"));
  const tf = (args: string[]): string => {
    const mask = process.umask(0o077);
    try {
      return cli("terraform", [`-chdir=${infra}`, ...args], undefined, undefined, {
        TF_WORKSPACE: "default", TF_DATA_DIR: resolve(infra, ".terraform"),
        TF_CLI_ARGS: "", [`TF_CLI_ARGS_${args[0]}`]: "",
      });
    } finally { process.umask(mask); }
  };
  tf(["init", "-input=false", "-lockfile=readonly"]);
  const state = object(parse(tf(["show", "-json"])));
  const module = state.values ? object(object(state.values).root_module ?? {}) : {};
  const resources = (module.resources ?? []) as StateResource[];
  requireValue(Array.isArray(resources) && !module.child_modules, "Unexpected nested local state; review manually.");
  const managed = resources.filter(item => item.mode === "managed");
  const frontendEnvironment = managed.find(item => item.address === "azurerm_container_app_environment.workshop");
  requireValue(!frontendEnvironment || frontendEnvironment.values.infrastructure_subnet_id,
    "Legacy single-environment state has no VNet. Stop and plan an explicit migration/recreation with its private backup; setup will not replace the environment or deploy more images.");
  const groupScope = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}`;
  requireValue(managed.every(item => [...foundation, ...appAddresses].includes(item.address)
    && item.values.id?.toLowerCase().startsWith(`${groupScope.toLowerCase()}/providers/`)),
  "Existing local state targets unexpected resources or another subscription/resource group.");
  requireValue(rawState !== undefined || managed.length === 0, "Unexpected state appeared during initialization; stop and review.");
  const registry = managed.find(item => item.address === foundation[0]);
  if (registry) matchingVariables(variables, {
    ACR_NAME: registry.values.name ?? "", ACR_LOGIN_SERVER: registry.values.login_server ?? "",
  });
  const existingApps = managed.filter(item => appAddresses.includes(item.address));
  const trackedIds = new Set(managed.map(item => item.values.id?.toLowerCase()));
  const activeTypes = ["microsoft.containerregistry/registries", "microsoft.app/containerapps", "microsoft.app/managedenvironments",
    "microsoft.network/virtualnetworks", "microsoft.network/networksecuritygroups", "microsoft.network/privatednszones"];
  requireValue(cloud.every(item => !activeTypes.includes(item.type.toLowerCase()) || trackedIds.has(item.id.toLowerCase())),
    "ACR/Container Apps/network resources already exist without matching local state. Restore the original local state; no adoption or replacement was attempted.");
  requireValue(managed.length === 0 || registry, "Existing state has no registry; restore/review it, never fall back to an empty foundation.");
  requireValue(managed.length === 0 || saved, "Existing state requires the original private deployment variables.");
  requireValue(saved || !legacySecrets || (config.initializeFreshEnvironment === true && managed.length === 0),
    "Legacy GitHub application secrets exist but the local deployment file is missing. Restore its private backup, or review an undeployed environment and explicitly set initializeFreshEnvironment=true; existing ACR/ACA or nonempty state cannot be replaced. GitHub secrets were not adopted, deleted or rotated.");
  if (saved && saved.image_tag !== head && managed.length === 0 && cloud.length === 0) {
    saved.image_tag = head;
    writeFileSync(tfvarsPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
    console.log("No provisioned Azure resources; using the current checkout for initial images. Saved credentials were preserved.");
  }
  if (existingApps.length < appAddresses.length) requireValue((saved?.image_tag ?? head) === head,
    "Incomplete setup uses a different image SHA. Check out the saved commit before resuming; never rebuild a saved tag from different sources.");
  if (!saved) {
    saved = { ...settings, image_tag: head, ...Object.fromEntries(secretNames.map(name => [
      name.toLowerCase(), name === "APP_CLIENT_ID" ? randomUUID() : randomBytes(32).toString("hex"),
    ])) };
    writeFileSync(tfvarsPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  setupRepository(config.repository);
  if (!group) scoped(["group", "create", "--name", config.resourceGroup, "--location", config.location, "--tags", `repository=${config.repository}`, "purpose=synthetic-sdlc-workshop"]);
  if (!app) app = az<Identity>(["rest", "--method", "post", "--url", "https://graph.microsoft.com/v1.0/applications",
    "--body", JSON.stringify({ displayName, signInAudience: "AzureADMyOrg", tags: [ownershipTag] })]);
  if (!principal) principal = az<Identity>(["ad", "sp", "create", "--id", app.appId]);
  requireValue(uuid.test(app.appId) && uuid.test(principal.id), "Azure returned invalid deployment identity IDs.");
  if (saved.deployment_principal_object_id === undefined) {
    saved.deployment_principal_object_id = principal.id;
    writeFileSync(tfvarsPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  }
  if (!existingFederation) az(["ad", "app", "federated-credential", "create", "--id", app.id, "--parameters", JSON.stringify(federation)]);
  const assignments = scoped<{ principalId: string; scope: string; roleDefinitionId: string }[]>(["role", "assignment", "list", "--scope", groupScope, "--include-inherited"]);
  const roleId = "358470bc-b998-42bd-ab17-a7e34c199c0f";
  if (!assignments.some(item => item.principalId.toLowerCase() === principal.id.toLowerCase()
    && item.scope.toLowerCase() === groupScope.toLowerCase() && item.roleDefinitionId.toLowerCase().endsWith(`/${roleId}`))) {
    scoped(["role", "assignment", "create", "--assignee-object-id", principal.id, "--assignee-principal-type", "ServicePrincipal",
      "--role", "Container Apps Contributor", "--scope", groupScope]);
  }
  if (assignments.some(item => item.principalId.toLowerCase() === principal.id.toLowerCase()
    && !(item.scope.toLowerCase() === groupScope.toLowerCase() && item.roleDefinitionId.toLowerCase().endsWith(`/${roleId}`))
    && !(item.scope.toLowerCase() === registry?.values.id?.toLowerCase()
      && ["8311e382-0749-4cb8-b61a-304f252e45ec", "acdd72a7-3385-48ef-bd42-f606fba81ae7"]
        .some(role => item.roleDefinitionId.toLowerCase().endsWith(`/${role}`))))) {
    console.warn("Existing broader deployment roles were preserved; review least privilege manually. Setup never deletes role assignments.");
  }
  const apply = (appsEnabled: boolean): void => {
    const plan = ".state/deployment.tfplan";
    localFile(resolve(infra, plan));
    tf(["plan", "-input=false", "-var-file=deployment.auto.tfvars.json", `-var=enable_apps=${appsEnabled}`, `-out=${plan}`]);
    const changes = (object(parse(tf(["show", "-json", plan]))).resource_changes ?? []) as PlanChange[];
    requireValue(Array.isArray(changes) && changes.every(change => (change.mode === "data"
      ? change.address === "data.azurerm_resource_group.workshop" && change.change.actions.every(action => ["read", "no-op"].includes(action))
      : change.mode === "managed" && [...foundation, ...(appsEnabled ? appAddresses : [])].includes(change.address)
        && change.change.actions.every(action => ["create", "update", "no-op"].includes(action)))),
    "Plan contains deletion, replacement or unexpected resources; no apply was run.");
    console.log(`Local plan: ${changes.filter(item => item.change.actions.includes("create")).length} create, ${changes.filter(item => item.change.actions.includes("update")).length} update, 0 delete.`);
    tf(["apply", "-input=false", plan]);
  };
  if (managed.length === 0) apply(false);
  const outputs = parse(tf(["output", "-json"])) as Record<string, { value: string }>;
  const acrName = outputs.acr_name?.value;
  const acrServer = outputs.acr_login_server?.value;
  requireValue(typeof acrName === "string" && /^[a-z0-9]{5,50}$/.test(acrName)
    && acrServer === `${acrName}.azurecr.io` && (!registry || (registry.values.name === acrName && registry.values.login_server === acrServer)),
  "Local state registry outputs are missing or inconsistent; restore/review state before any image build.");
  matchingVariables(variables, { ACR_NAME: acrName, ACR_LOGIN_SERVER: acrServer, AZURE_CLIENT_ID: app.appId });
  if (existingApps.length < appAddresses.length) {
    cli("node", [resolve(root, "scripts/build-images.ts"), config.subscriptionId, acrName, saved.image_tag as string, root],
      undefined, "Image builds failed; inspect ACR Tasks before retrying. Captured output withheld.");
  }
  apply(true);
  if (!demo) {
    api("environments/demo", "PUT", { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
    api("environments/demo/deployment-branch-policies", "POST", { name: "main", type: "branch" });
  }
  Object.assign(expectedVars, { AZURE_CLIENT_ID: app.appId, ACR_NAME: acrName, ACR_LOGIN_SERVER: acrServer });
  for (const [name, value] of Object.entries(expectedVars)) {
    if (variables[name] !== value) cli("gh", ["variable", "set", name, "--repo", config.repository, "--body", value]);
  }
  console.log("Full environment created with local Terraform state. Back up infra/.state and deployment.auto.tfvars.json privately. Actions owns subsequent image updates only.");
}

if (import.meta.main) {
  try { setup(process.argv[2]); }
  catch (error) {
    console.error(error instanceof Error && !("code" in error) ? error.message : "Infrastructure setup failed; check private artifact paths and CLI availability.");
    process.exitCode = 1;
  }
}
