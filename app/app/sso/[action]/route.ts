import { sameOrigin, setting } from "../../../auth/session";

type Context = { params: Promise<{ action: string }> };
async function proxy(request: Request, action: string) {
  const headers = { "Cache-Control": "no-store" };
  if ((request.method === "GET" && !["authorize", "theme.css"].includes(action)) ||
    (request.method === "POST" && action !== "login")) return new Response(null, { status: 404, headers });
  if (request.method === "POST" && !sameOrigin(request)) return new Response(null, { status: 403, headers });
  try {
    let body: string | undefined;
    if (request.method === "POST") {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            return new Response(null, { status: 413, headers });
          }
          chunks.push(item.value);
        }
      }
      body = Buffer.concat(chunks).toString();
    }
    const upstream = await fetch(`${setting("SSO_URL")}/${action}${new URL(request.url).search}`, {
      method: request.method, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10000),
      ...(body !== undefined ? { body, headers: { "Content-Type": request.headers.get("content-type") ?? "" } } : {}),
    });
    const location = upstream.headers.get("location");
    if (location && !/^\/auth\/callback\?code=[a-f0-9]{64}&state=[a-f0-9]{64}$/.test(location)) {
      return new Response(null, { status: 502, headers });
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status, headers: {
        ...headers, "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        ...(location ? { Location: location } : {}),
      },
    });
  } catch {
    return Response.json({ error: "SSO 서버에 연결할 수 없습니다." }, { status: 502, headers });
  }
}
export async function GET(request: Request, context: Context) { return proxy(request, (await context.params).action); }
export async function POST(request: Request, context: Context) { return proxy(request, (await context.params).action); }
