import assert from "node:assert/strict";
import config from "./next.config.js";
import { realpathSync } from "node:fs";

test("Next.js produces a standalone application without a custom HTTP server", () => {
  assert.equal(config.output, "standalone");
  assert.equal(config.poweredByHeader, false);
  assert.equal(realpathSync(config.outputFileTracingRoot ?? ""), realpathSync("."));
});
