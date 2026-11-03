import { createHash, randomBytes } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { application, errors, required, HttpError } from "./http/http.js";
import { equalSecret, signToken } from "./auth/tokens.js";

const loginSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.literal("/auth/callback"),
  state: z.string().regex(/^[0-9a-f]{64}$/),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
}).strict();
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function createSso(env: NodeJS.ProcessEnv): { app: Express; close: () => Promise<void> } {
  const clientId = required(env, "APP_CLIENT_ID");
  const key = required(env, "SSO_SESSION_KEY", 32);
  const codes = new Map<string, { challenge: string; expires: number }>();
  const app = application();
  app.get("/ready", (_req, res) => res.json({ status: "ready" }));
  app.get("/theme.css", (_req, res) => {
    res.type("css").send(`
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#171717;background:#f5f5f5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
.login-card{width:min(100%,440px);padding:32px;background:white;border:1px solid #d4d4d4;border-radius:12px}
h1{font-size:1.6rem}p{line-height:1.6}.badge{font-size:.75rem;font-weight:700;letter-spacing:.12em}
form{display:grid;gap:16px}label{display:grid;gap:8px;font-weight:600}
input,button{width:100%;padding:12px;font:inherit;border:1px solid #a3a3a3;border-radius:6px}
button{background:#171717;color:white;border-color:#171717;cursor:pointer}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #525252;outline-offset:3px}
.muted{color:#525252;font-size:.875rem;margin:0}a{display:inline-block;margin-top:24px;color:inherit}
`);
  });

  function authorization(value: unknown) {
    const parsed = loginSchema.safeParse(value);
    if (!parsed.success || !equalSecret(parsed.data.client_id, clientId)) throw new HttpError(400, "Invalid Mock SSO request");
    return parsed.data;
  }
  function cleanup() {
    for (const [code, record] of codes) if (record.expires <= Date.now()) codes.delete(code);
  }
  app.get("/authorize", (req, res) => {
    const params = authorization(req.query);
    const fields = Object.entries(params).map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`).join("");
    // Relative URLs work both directly and behind the generated app's /sso/ proxy.
    res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock SSO 로그인</title><link rel="stylesheet" href="theme.css"></head><body><main class="login-card"><p class="badge">MOCK SSO</p><h1>데모 계정으로 로그인</h1><p>로그인 화면과 세션 흐름을 체험합니다. 실제 회사 계정이나 비밀번호를 입력하지 마세요.</p><form method="post" action="login">${fields}<label>데모 사용자<input name="username" value="demo" required autocomplete="off"></label><label>데모 비밀번호<input name="password" type="password" value="demo1234" required autocomplete="off"></label><p class="muted">실습 전용: demo / demo1234</p><button type="submit">로그인</button></form><a href="/">앱으로 돌아가기</a></main></body></html>`);
  });
  app.post("/login", (req, res) => {
    const login = z.object({ username: z.string(), password: z.string() }).passthrough().safeParse(req.body);
    if (!login.success) throw new HttpError(400, "Invalid Mock SSO login");
    const { username, password, ...request } = login.data;
    const params = authorization(request);
    if (!equalSecret(username, "demo") || !equalSecret(password, "demo1234")) throw new HttpError(401, "Use the demo account: demo / demo1234");
    cleanup();
    if (codes.size >= 1000) throw new HttpError(429, "Too many pending logins; retry later");
    const code = randomBytes(32).toString("hex");
    codes.set(code, { challenge: params.code_challenge, expires: Date.now() + 60000 });
    res.redirect(303, `/auth/callback?${new URLSearchParams({ code, state: params.state })}`);
  });
  app.post("/token", async (req, res) => {
    const params = z.object({
      client_id: z.string(), code: z.string().regex(/^[0-9a-f]{64}$/),
      redirect_uri: z.literal("/auth/callback"),
      code_verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      grant_type: z.literal("authorization_code"),
    }).strict().safeParse(req.body);
    if (!params.success || !equalSecret(params.data.client_id, clientId)) throw new HttpError(400, "Invalid Mock SSO exchange");
    cleanup();
    const code = codes.get(params.data.code);
    if (!code || !equalSecret(code.challenge, createHash("sha256").update(params.data.code_verifier).digest("base64url"))) {
      throw new HttpError(401, "Invalid or expired Mock SSO code");
    }
    codes.delete(params.data.code);
    res.json({
      session_token: await signToken(key, "simplified-sdlc-sso", clientId, "demo", { name: "Demo User", mock: true }, 900),
      expires_in: 900,
    });
  });
  errors(app);
  return { app, close: async () => { codes.clear(); } };
}
