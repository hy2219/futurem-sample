import { spawnSync } from "node:child_process";

const rulesetName = "simplified-sdlc-main";
const policy = {
  name: rulesetName,
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: true,
    } },
    { type: "required_status_checks", parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "ci", integration_id: 15368 }],
    } },
  ],
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GitHub ruleset response.");
  return value as Record<string, unknown>;
}

function requirePolicy(value: unknown): void {
  const rule = object(value);
  const refs = object(object(rule.conditions).ref_name);
  const rules = Array.isArray(rule.rules) ? rule.rules.map(object) : [];
  const checks = rules.find(item => item.type === "required_status_checks");
  const parameters = object(checks?.parameters);
  if (rule.name !== rulesetName || rule.target !== "branch" || rule.enforcement !== "active"
    || !Array.isArray(rule.bypass_actors) || rule.bypass_actors.length !== 0
    || !Array.isArray(refs.include) || refs.include.length !== 1 || refs.include[0] !== "refs/heads/main"
    || !Array.isArray(refs.exclude) || refs.exclude.length !== 0
    || !["pull_request", "deletion", "non_fast_forward"].every(type => rules.some(item => item.type === type))
    || parameters.strict_required_status_checks_policy !== true
    || !Array.isArray(parameters.required_status_checks)
    || !parameters.required_status_checks.some(value => {
      const check = object(value);
      return check.context === "ci" && check.integration_id === 15368;
    })) {
    throw new Error("Existing main ruleset does not enforce PR-only merges and the required ci check without bypass. Review it manually; existing rules were not weakened.");
  }
}

export function setupRepository(repository: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Provide the actual GitHub owner/repository.");
  }
  function api(path: string, body?: unknown): unknown {
    const result = spawnSync("gh", [
      "api", `repos/${repository}/${path}`,
      ...(body === undefined ? path.includes("?") ? ["--paginate", "--slurp"] : [] : ["--method", "POST", "--input", "-"]),
    ], {
      encoding: "utf8", shell: false, stdio: ["pipe", "pipe", "pipe"],
      input: body === undefined ? undefined : JSON.stringify(body),
      env: { ...process.env, GH_HOST: "github.com" },
    });
    if (result.error || result.status !== 0) {
      throw new Error("GitHub main protection could not be read/applied. Private repositories require GitHub Pro, Team or Enterprise and repository admin permission. Check gh authentication and policy support; protection is NOT confirmed.");
    }
    try { return JSON.parse(result.stdout); }
    catch { throw new Error("Invalid GitHub ruleset JSON response (content withheld)."); }
  }
  const pages = api("rulesets?includes_parents=false&per_page=100");
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("Invalid GitHub ruleset list.");
  const existing = pages.flat().map(object).filter(item => item.name === rulesetName);
  if (existing.length > 1) throw new Error("Multiple matching main rulesets exist; review manually.");
  const selected = existing[0] ?? object(api("rulesets", policy));
  if (!Number.isSafeInteger(selected.id) || Number(selected.id) <= 0) throw new Error("Invalid GitHub ruleset ID.");
  requirePolicy(api(`rulesets/${selected.id}`));
}

if (import.meta.main) {
  try {
    setupRepository(process.argv[2] ?? "");
    console.log("Main requires a PR and the successful ci check; no bypass actors, force pushes or deletion.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Repository policy setup failed.");
    process.exitCode = 1;
  }
}
