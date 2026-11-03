import { required } from "../http/http.js";
import { checkSsoContract } from "./helpers/contract.js";
import type { SsoTarget } from "./helpers/contract.js";

describe("running Mock SSO container HTTP contract", () => {
  let target: SsoTarget;
  beforeAll(() => {
    target = {
      url: process.env.SSO_URL ?? "http://127.0.0.1:3102",
      clientId: required(process.env, "APP_CLIENT_ID"),
      key: required(process.env, "SSO_SESSION_KEY", 32),
    };
  });
  checkSsoContract(() => target);
});
