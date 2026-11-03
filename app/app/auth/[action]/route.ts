import { createHash } from "node:crypto";
import { cookie, equal, loginState, readCookie, readLoginState, sameOrigin, sessionClaims, setting } from "../../../auth/session";

type Context = { params: Promise<{ action: string }> };

function response(status: number, error: string | null, headers: HeadersInit = {}) {
  return new Response(error ? JSON.stringify({ error }) : null, {
    status, headers: { "Cache-Control": "no-store", "Content-Type": "application/json", ...headers },
  });
}

export async function GET(request: Request, context: Context) {
  const { action } = await context.params;
  if (action === "login") {
    const pending = loginState();
    const query = new URLSearchParams({
      client_id: setting("APP_CLIENT_ID"), redirect_uri: "/auth/callback",
      state: pending.state, code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
    });
    return response(303, null, {
      Location: `/sso/authorize?${query}`, "Set-Cookie": cookie("demo_login", pending.signed, 300),
    });
  }
  if (action !== "callback") return response(404, "찾을 수 없는 인증 경로입니다.");
  const headers = {
    "Set-Cookie": cookie("demo_login", "", 0), "Referrer-Policy": "no-referrer",
  };
  const query = new URL(request.url).searchParams;
  const pending = readLoginState(readCookie(request, "demo_login"));
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  if (!pending || !equal(state, pending.state) || !/^[a-f0-9]{64}$/.test(code) ||
    [...query.keys()].some(key => !["state", "code"].includes(key) || query.getAll(key).length !== 1)) {
    return response(400, "로그인 상태가 유효하지 않습니다. 새 로그인을 시작하세요.", headers);
  }
  try {
    const upstream = await fetch(`${setting("SSO_URL")}/token`, {
      method: "POST", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: setting("APP_CLIENT_ID"), code, redirect_uri: "/auth/callback",
        code_verifier: pending.verifier, grant_type: "authorization_code",
      }),
    });
    if (!upstream.ok) return response(upstream.status === 401 ? 401 : 502, "SSO 코드 교환에 실패했습니다. 새 로그인을 시작하세요.", headers);
    const body = await upstream.json();
    const claims = typeof body.session_token === "string" ? sessionClaims(body.session_token) : null;
    if (!claims) return response(401, "SSO 세션이 유효하지 않습니다.", headers);
    const result = response(303, null, { ...headers, Location: "/" });
    result.headers.append("Set-Cookie", cookie("demo_session", body.session_token, claims.exp - Date.now() / 1000));
    return result;
  } catch {
    return response(502, "SSO 서버에 연결할 수 없습니다.", headers);
  }
}

export async function POST(request: Request, context: Context) {
  if ((await context.params).action !== "logout") return response(404, "찾을 수 없는 인증 경로입니다.");
  if (!sameOrigin(request)) return response(403, "동일 출처의 로그아웃 요청만 허용합니다.");
  const result = response(200, null);
  result.headers.append("Set-Cookie", cookie("demo_session", "", 0));
  result.headers.append("Set-Cookie", cookie("demo_login", "", 0));
  return result;
}
