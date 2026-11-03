import { cloud, config, resetCloud } from "./__mocks__/infra-setup.js";
import { setupRepository } from "./repository-setup.js";

vi.mock("node:child_process", () => import("./__mocks__/infra-setup.js"));
beforeEach(() => resetCloud(""));

test("creates and rereads an active PR-only main policy without bypass, then preserves it", () => {
  setupRepository(config.repository);
  expect(cloud.rulesets).toHaveLength(1);
  expect(cloud.rulesets[0]).toMatchObject({
    name: "simplified-sdlc-main", enforcement: "active", bypass_actors: [],
  });
  const previous = structuredClone(cloud.rulesets);
  cloud.calls = [];
  setupRepository(config.repository);
  expect(cloud.rulesets).toEqual(previous);
  expect(cloud.calls.some(call => call.args.includes("POST"))).toBe(false);
  expect(cloud.calls.some(call => call.args[1].endsWith("/rulesets/1"))).toBe(true);
});

test("does not touch unrelated repository policies", () => {
  cloud.rulesets.push({ id: 9, name: "company-policy", enforcement: "active" });
  setupRepository(config.repository);
  expect(cloud.rulesets[0]).toEqual({ id: 9, name: "company-policy", enforcement: "active" });
  expect(cloud.rulesets).toHaveLength(2);
});

test("reports unsupported private-plan/auth failures without pretending protection is active", () => {
  cloud.failure = { command: "gh", prefix: `api repos/${config.repository}/rulesets` };
  expect(() => setupRepository(config.repository)).toThrow(/GitHub Pro, Team or Enterprise/);
  expect(cloud.rulesets).toEqual([]);
  expect(cloud.calls.some(call => call.args.includes("POST"))).toBe(false);
});

test.each(["disabled", "bypass", "wrong-check", "wrong-provider", "no-pr", "excluded-main"])(
  "refuses %s policy drift instead of overwriting existing protection", change => {
    setupRepository(config.repository);
    const existing = cloud.rulesets[0];
    if (change === "disabled") existing.enforcement = "disabled";
    if (change === "bypass") existing.bypass_actors = [{ actor_type: "RepositoryRole", actor_id: 5 }];
    if (change === "excluded-main") existing.conditions = { ref_name: { include: ["refs/heads/main"], exclude: ["refs/heads/main"] } };
    if (change === "no-pr") existing.rules = (existing.rules as { type: string }[]).filter(rule => rule.type !== "pull_request");
    if (change === "wrong-check" || change === "wrong-provider") {
      existing.rules = [
        { type: "pull_request" }, { type: "deletion" }, { type: "non_fast_forward" },
        { type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: change === "wrong-check" ? "unit" : "ci",
            integration_id: change === "wrong-provider" ? null : 15368 }],
        } },
      ];
    }
    cloud.calls = [];
    expect(() => setupRepository(config.repository)).toThrow(/Existing main ruleset/);
    expect(cloud.calls.some(call => call.args.includes("POST"))).toBe(false);
  });

test("rejects invalid repository paths and malformed API responses", () => {
  expect(() => setupRepository("owner/../repo")).toThrow(/owner\/repository/);
  expect(cloud.calls).toEqual([]);
  cloud.malformed = `api repos/${config.repository}/rulesets`;
  expect(() => setupRepository(config.repository)).toThrow(/Invalid GitHub ruleset JSON/);
});
