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

test("board API requires a valid session and never shares cached responses", async () => {
  const response = await GET(new Request("http://app/api/changes"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetch).not.toHaveBeenCalled();
});

test("board API rejects empty, duplicated and unsupported query parameters before MCP", async () => {
  for (const search of ["?change_id=", "?change_id=a&change_id=b", "?status=approved", "?sql=SELECT"]) {
    expect((await GET(signedRequest(search))).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("board API returns explicit partial failure without inventing summary zeros", async () => {
  failedTool.mockReturnValue("list_change_requests");
  const response = await GET(signedRequest());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.changes).toHaveProperty("error");
  expect(body).not.toHaveProperty("summary");
  expect(body.assets.data).toHaveLength(1);
});
