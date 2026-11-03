import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

type BuildOptions = { root: string; subscriptionId: string; registry: string; imageTag: string };

export async function buildImages({ root, subscriptionId, registry, imageTag }: BuildOptions): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)
    || !/^[a-z0-9]{5,50}$/.test(registry) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(imageTag)) {
    throw new Error("Invalid build subscription, registry or image tag.");
  }
  try {
    if (!root || !statSync(root).isDirectory()) throw new Error();
    root = resolve(root);
  } catch { throw new Error("Invalid build root directory."); }
  const images = [
    ["external-resources", ".", "mcp/Dockerfile"], ["mock-sso", "sso", "Dockerfile"],
    ["api-1", "external_resources/api_1", "Dockerfile"], ["api-2", "external_resources/api_2", "Dockerfile"],
    ["db-1", "external_resources/db_1", "Dockerfile"], ["db-2", "external_resources/db_2", "Dockerfile"],
    ["business-app", "app", "Dockerfile"],
  ];
  const build = ([image, context, dockerfile]: string[]): Promise<void> => new Promise((done, reject) => {
    const fail = (runId?: string): void => reject(new Error(
      `Image ${image}${runId ? ` run ${runId}` : ""} failed; inspect ACR Tasks in ${registry} before retrying. Captured output withheld.`,
    ));
    console.log(`Building ${image}:${imageTag} with ACR Tasks.`);
    try {
      execFile("az", [
        "acr", "build", "--subscription", subscriptionId, "--registry", registry,
        "--image", `${image}:${imageTag}`, "--file", resolve(root, context, dockerfile),
        "--no-logs", "--timeout", "1800", "--output", "json", "--only-show-errors", resolve(root, context),
      ], {
        cwd: root, encoding: "utf8", shell: false, timeout: 35 * 60_000, killSignal: "SIGKILL",
        maxBuffer: 16 * 1024 * 1024, env: { ...process.env, AZURE_CORE_COLLECT_TELEMETRY: "false" },
      }, (error, stdout) => {
        if (error) return fail();
        let run: unknown;
        try { run = JSON.parse(stdout); } catch { return fail(); }
        if (!run || typeof run !== "object" || Array.isArray(run)) return fail();
        const result = run as Record<string, unknown>;
        const runId = typeof result.runId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(result.runId) ? result.runId : undefined;
        if (!runId || result.status !== "Succeeded") return fail(runId);
        console.log(`Image ${image} run ${runId} succeeded.`);
        done();
      });
    } catch { fail(); }
  });
  for (let offset = 0; offset < images.length; offset += 3) {
    // Drain every submitted process before failing; never leave sibling builds unobserved.
    const results = await Promise.allSettled(images.slice(offset, offset + 3).map(build));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 6) throw new Error("Usage: node scripts/build-images.ts <subscription-id> <registry> <image-tag> <root>");
    const [subscriptionId, registry, imageTag, root] = process.argv.slice(2);
    await buildImages({ root, subscriptionId, registry, imageTag });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Image builds failed; inspect ACR Tasks. Captured output withheld.");
    process.exitCode = 1;
  }
}
