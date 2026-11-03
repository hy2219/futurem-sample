import { authenticated } from "../../../auth/session";
import { changeBoard } from "../../../resources/client";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authenticated(request)) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== "change_id" || query.getAll(key).length !== 1) ||
    (query.has("change_id") && !query.get("change_id")?.trim())) {
    return Response.json({ error: "잘못된 조회 조건입니다." }, { status: 400, headers });
  }
  try {
    return Response.json(await changeBoard(query.get("change_id") ?? undefined), { headers });
  } catch {
    return Response.json({ error: "변경 점검 정보를 조회하지 못했습니다." }, { status: 502, headers });
  }
}
