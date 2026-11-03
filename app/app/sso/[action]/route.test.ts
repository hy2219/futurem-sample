import { GET, POST } from "./route.js";

test("does not proxy arbitrary URLs, actions or cross-origin credentials", async () => {
  expect((await GET(new Request("http://app/sso/unknown"), { params: Promise.resolve({ action: "unknown" }) })).status).toBe(404);
  expect((await POST(new Request("http://app/sso/login", { method: "POST", headers: { origin: "http://evil" } }), { params: Promise.resolve({ action: "login" }) })).status).toBe(403);
});
