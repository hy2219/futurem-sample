import { GET } from "./route.js";
import { signedRequest } from "../../../__mocks__/auth/session.js";
import { failedTool, fetch } from "../../../__mocks__/fetch.js";

beforeEach(() => {
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("APP_CLIENT_ID", "unit-client");
  vi.stubEnv("SSO_SESSION_KEY", "unit-key");
  vi.stubEnv("APP_CLIENT_SECRET", "unit-secret");
  vi.stubEnv("MCP_URL", "http://unit-mcp/mcp");
});

test("refuses unauthenticated asset reads with no shared cache", async () => {
  const response = await GET(new Request("http://app/api/assets"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toHaveProperty("error");
});

test("validates optional status, rejects duplicates, empty IDs and arbitrary SQL before calling MCP", async () => {
  for (const search of ["?status=unknown", "?asset_id=", "?status=retired&status=operational", "?sql=SELECT", "?asset_id=AST-001&status=operational"]) {
    expect((await GET(signedRequest(search))).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
  const response = await GET(signedRequest("?status=operational"));
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveProperty("assets");
  const calls = fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(calls.some(call => call.params.name === "list_it_assets" && call.params.arguments.status === "operational")).toBe(true);
});

test("distinguishes upstream failure, missing asset, and successful detail including empty sections", async () => {
  failedTool.mockReturnValue("list_it_assets");
  expect((await GET(signedRequest())).status).toBe(502);
  failedTool.mockReturnValue("");
  expect((await GET(signedRequest("?asset_id=missing"))).status).toBe(404);
  const response = await GET(signedRequest("?asset_id=AST-001"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ detail: { asset: { asset_id: "AST-001" }, changes: { data: [] } } });
});
