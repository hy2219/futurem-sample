import assert from "node:assert/strict";
import { HttpError, required, errorCode, requestJson } from "./http.js";
import { fetch, resetHttp, upstream as peer } from "../__mocks__/http/http.js";

beforeEach(resetHttp);

test("http configuration fails explicitly and error codes do not expose request values", () => {
  assert.equal(required({ NAME: "value" }, "NAME"), "value");
  assert.throws(() => required({}, "NAME"), /NAME/);
  assert.throws(() => required({ NAME: "x" }, "NAME", 32), /NAME/);
  assert.equal(errorCode(Object.assign(new Error("private detail"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
  assert.equal(errorCode(undefined), "UnknownError");
  assert.equal(new HttpError(403, "Denied").status, 403);
});
test("requestJson propagates safe upstream errors and rejects invalid JSON", async () => {
  vi.stubGlobal("fetch", fetch);
  assert.deepEqual(await requestJson("http://example.test"), peer.data);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(peer.requests[0][0], "http://example.test");
  assert.ok(peer.requests[0][1]?.signal instanceof AbortSignal);
  peer.deny();
  await assert.rejects(requestJson("http://example.test"), { status: 403, message: "Denied" });
  peer.invalidJson();
  await assert.rejects(requestJson("http://example.test"), { status: 502 });
  peer.unavailable();
  await assert.rejects(requestJson("http://example.test"), { status: 502 });
});
