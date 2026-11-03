import { resolve } from "node:path";
import { builds, execFile, resetBuilds } from "./__mocks__/build-images.js";
import { buildImages } from "./build-images.js";

vi.mock("node:child_process", () => import("./__mocks__/build-images.js"));
const options = {
  root: resolve("."), subscriptionId: "11111111-1111-4111-8111-111111111111",
  registry: "workshopacr123456", imageTag: "a".repeat(40),
};
const flush = (): Promise<void> => new Promise(done => setImmediate(done));
beforeEach(() => {
  resetBuilds();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

it("starts three native builds before callbacks and waits for each whole batch before submitting more", async () => {
  builds.setAutoComplete(false);
  const running = buildImages(options);
  expect(builds.calls).toHaveLength(3);
  expect(builds.active).toBe(3);
  builds.complete(0);
  builds.complete(2);
  await flush();
  expect(builds.calls).toHaveLength(3);
  builds.complete(1);
  await flush();
  expect(builds.calls).toHaveLength(6);
  for (const index of [3, 4, 5]) builds.complete(index);
  await flush();
  expect(builds.calls).toHaveLength(7);
  builds.complete(6);
  await running;
  expect(builds.peak).toBe(3);
  expect(builds.active).toBe(0);
});

it("requires all seven native success responses and normalizes context, Dockerfile and working-directory paths", async () => {
  await buildImages({ ...options, root: "scripts/.." });
  const images = [
    ["external-resources", ".", "mcp/Dockerfile"], ["mock-sso", "sso", "Dockerfile"],
    ["api-1", "external_resources/api_1", "Dockerfile"], ["api-2", "external_resources/api_2", "Dockerfile"],
    ["db-1", "external_resources/db_1", "Dockerfile"], ["db-2", "external_resources/db_2", "Dockerfile"],
    ["business-app", "app", "Dockerfile"],
  ];
  expect(builds.calls).toHaveLength(7);
  for (const [index, [image, context, dockerfile]] of images.entries()) {
    const call = builds.calls[index];
    expect(call.command).toBe("az");
    expect(call.args).toEqual([
      "acr", "build", "--subscription", options.subscriptionId, "--registry", options.registry,
      "--image", `${image}:${options.imageTag}`, "--file", resolve(options.root, context, dockerfile),
      "--no-logs", "--timeout", "1800", "--output", "json", "--only-show-errors", resolve(options.root, context),
    ]);
    expect(call.options).toMatchObject({
      cwd: options.root, encoding: "utf8", shell: false, timeout: 35 * 60_000, killSignal: "SIGKILL",
      env: { AZURE_CORE_COLLECT_TELEMETRY: "false" },
    });
  }
  expect(builds.peak).toBe(3);
  expect(builds.active).toBe(0);
  expect(console.log).toHaveBeenCalledWith("Image business-app run run-7 succeeded.");
});

it.each(["Failed", "Canceled", "Cancelled", "Error", "Timeout", "Queued", "Started", "Running", "Unexpected", undefined, null])(
  "rejects native completion status %s and submits no next batch", async status => {
    builds.setResponse("mock-sso", { stdout: JSON.stringify({ runId: "run-2", status }) });
    await expect(buildImages(options)).rejects.toThrow(/Image mock-sso run run-2 failed; inspect ACR Tasks/);
    expect(builds.calls).toHaveLength(3);
    expect(builds.active).toBe(0);
  });

it.each([
  "", "not-json-private-data", "warning private-data\n{\"status\":\"Succeeded\",\"runId\":\"run-2\"}",
  "null", "[]", "{}", '{"status":"Succeeded"}', '{"status":"Succeeded","runId":2}',
  '{"status":"Succeeded","runId":""}', '{"status":"Succeeded","runId":"invalid/private-data"}',
])("rejects empty, malformed or unidentified completion JSON without leaking its contents: %s", async stdout => {
  builds.setResponse("mock-sso", { stdout });
  await expect(buildImages(options)).rejects.toThrow("Image mock-sso failed; inspect ACR Tasks");
  expect(builds.calls).toHaveLength(3);
  expect(builds.active).toBe(0);
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-data");
});

it("awaits every already-submitted callback after a failure before rejecting", async () => {
  builds.setAutoComplete(false);
  const running = buildImages(options);
  const rejected = expect(running).rejects.toThrow(/mock-sso.*run-2.*inspect ACR Tasks/);
  let settled = false;
  void running.then(() => { settled = true; }, () => { settled = true; });
  builds.complete(1, { stdout: '{"runId":"run-2","status":"Failed"}' });
  await flush();
  expect(settled).toBe(false);
  expect(builds.active).toBe(2);
  expect(builds.calls).toHaveLength(3);
  builds.complete(0);
  await flush();
  expect(settled).toBe(false);
  builds.complete(2);
  await rejected;
  expect(builds.active).toBe(0);
  expect(builds.calls).toHaveLength(3);
});

it.each(["ETIMEDOUT", "ENOENT", "1"])("rejects native process error %s without exposing captured output", async code => {
  builds.setResponse("mock-sso", {
    error: Object.assign(new Error("private-data"), { code, killed: code === "ETIMEDOUT" }),
    stdout: '{"runId":"run-2","status":"Succeeded","source":"private-data"}',
    stderr: "token SAS private-data",
  });
  await expect(buildImages(options)).rejects.toThrow("Image mock-sso failed; inspect ACR Tasks");
  expect(builds.calls).toHaveLength(3);
  expect(builds.active).toBe(0);
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-data");
});

it("withholds synchronous process-launch errors while awaiting the other submitted builds", async () => {
  execFile.mockImplementationOnce(() => { throw new Error("private-data"); });
  await expect(buildImages(options)).rejects.toThrow("Image external-resources failed; inspect ACR Tasks");
  expect(execFile).toHaveBeenCalledTimes(3);
  expect(builds.calls).toHaveLength(2);
  expect(builds.active).toBe(0);
});

it("requires the final business-app build to succeed", async () => {
  builds.setResponse("business-app", { stdout: '{"runId":"run-7","status":"Failed"}' });
  await expect(buildImages(options)).rejects.toThrow(/business-app.*run-7.*inspect ACR Tasks/);
  expect(builds.calls).toHaveLength(7);
  expect(builds.active).toBe(0);
});

it("never logs native response source, token, SAS or stderr fields", async () => {
  builds.setResponse("external-resources", {
    stdout: JSON.stringify({ runId: "run-1", status: "Succeeded", source: "private-data", token: "private-data" }),
    stderr: "warning SAS private-data",
  });
  await buildImages(options);
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-data");
});

it.each([
  { subscriptionId: "--bad" }, { registry: "--bad" }, { registry: "abcd" }, { imageTag: "bad/tag" },
  { imageTag: "--bad" }, { root: "" }, { root: resolve("package.json") }, { root: resolve("scripts/no-such-build-root") },
])("rejects invalid build arguments before launching any process: %j", async invalid => {
  await expect(buildImages({ ...options, ...invalid })).rejects.toThrow(/Invalid build/);
  expect(builds.calls).toEqual([]);
});
