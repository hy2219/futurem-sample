import assert from "node:assert/strict";
import { GET } from "./route.js";

test("GET /health responds without runtime secrets or external service dependencies", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
