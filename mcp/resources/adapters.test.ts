import assert from "node:assert/strict";
import { createAdapters } from "./adapters.js";
import { httpPeer, requestJson, resetHttp } from "../__mocks__/http/http.js";

vi.mock("../http/http.js", () => import("../__mocks__/http/http.js"));
beforeEach(resetHttp);

test("adapters require configured, credential-free HTTP URLs", () => {
  const { resource, env } = httpPeer;
  assert.throws(() => createAdapters([resource], { ...env, API_URL: undefined }), /API_URL/);
  for (const value of ["invalid", "file:///tmp/resource", "http://user:password@example.test"]) {
    assert.throws(() => createAdapters([resource], { ...env, API_URL: value }));
  }
});
test("HTTP adapter constructs token-authenticated requests without following redirects", async () => {
  const { resource, env, requests, result } = httpPeer;
  const adapters = createAdapters([resource], env);
  const adapter = adapters.get("api");
  assert.ok(adapter);
  assert.deepEqual(await adapter.call(resource.tools[0], { search: "a b", available: false }, "fixture-token"), result);
  assert.equal(requests[0].url, "http://example.test/values?search=a+b&available=false");
  assert.equal(new Headers(requests[0].options.headers).get("Authorization"), "Bearer fixture-token");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(vi.mocked(requestJson).mock.calls.length, 1);
  httpPeer.fail();
  await assert.rejects(adapter.call(resource.tools[0], {}, "fixture-token"), { status: 503, message: "Prepared upstream failure" });
  await assert.rejects(adapter.call(resource.tools[0], { nested: {} }, "fixture-token"), { status: 400 });
  await adapter.close();
});
