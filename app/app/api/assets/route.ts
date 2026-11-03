import { authenticated } from "../../../auth/session";
import { assets, assetDetails } from "../../../resources/client";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authenticated(request)) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !["asset_id", "status"].includes(key) || query.getAll(key).length !== 1) ||
    (query.has("asset_id") && !query.get("asset_id")) ||
    (query.has("status") && !["operational", "maintenance", "retired"].includes(query.get("status") ?? "")) ||
    (query.has("asset_id") && query.has("status"))) {
    return Response.json({ error: "잘못된 조회 조건입니다." }, { status: 400, headers });
  }
  try {
    const id = query.get("asset_id");
    if (id) {
      const detail = await assetDetails(id);
      return detail ? Response.json({ assets: [detail.asset], detail }, { headers }) :
        Response.json({ error: "자산을 찾을 수 없습니다." }, { status: 404, headers });
    }
    return Response.json({ assets: await assets(query.get("status") ?? undefined) }, { headers });
  } catch {
    return Response.json({ error: "자산 리소스 조회에 실패했습니다." }, { status: 502, headers });
  }
}
