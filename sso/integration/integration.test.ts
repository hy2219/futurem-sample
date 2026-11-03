import { checkSsoContract } from "./helpers/contract.js";
import type { SsoTarget } from "./helpers/contract.js";
import { localSso } from "./helpers/local-sso.js";

describe("Mock SSO HTTP contract integrates server, HTTP helpers, and tokens in-process", () => {
  let target: SsoTarget;
  beforeAll(async () => {
    target = await localSso({ onTestFinished: afterAll });
  });
  checkSsoContract(() => target);
});
