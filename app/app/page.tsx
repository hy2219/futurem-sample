"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Link, Select, Table } from "@hy2219/custom-ui/react";
import type { Asset, AssetDetail } from "../resources/client";

type State = { kind: "loading" | "unauthenticated" | "error"; message?: string } |
  { kind: "ready"; assets: Asset[]; detail?: AssetDetail };

export default function Home() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/assets${window.location.search}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { setState({ kind: "unauthenticated" }); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "조회에 실패했습니다.");
        setState({ kind: "ready", assets: body.assets, ...(body.detail ? { detail: body.detail } : {}) });
      } catch (error) {
        if (!controller.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "서버에 연결할 수 없습니다." });
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function logout() {
    try {
      const response = await fetch("/auth/logout", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("로그아웃에 실패했습니다.");
      setState({ kind: "unauthenticated" });
    } catch {
      setState({ kind: "error", message: "로그아웃에 실패했습니다. 다시 시도하세요." });
    }
  }

  return <Card title="제조 IT 시스템 조회" body="합성 데이터만 사용하는 읽기 전용 데모입니다.">
    <Link href="/changes" text="변경 점검 보드" />
    {state.kind === "loading" && <Alert text="로그인 상태를 확인하는 중" />}
    {state.kind === "unauthenticated" && <Card title="데모 로그인 안내" body="Mock SSO로 로그인하면 IT 자산을 조회할 수 있습니다.">
      <Link href="/auth/login" text="데모 로그인" />
    </Card>}
    {state.kind === "error" && <>
      <Alert tone="danger" heading="조회 오류" text={state.message ?? "조회에 실패했습니다."} />
      <Link href="/" text="전체 자산" />
    </>}
    {state.kind === "ready" && <>
      <Button variant="secondary" onClick={logout}>로그아웃</Button>
      <Link href="/" text="전체 자산" />
      {!state.detail && <Select id="asset-status" label="자산 상태"
        defaultValue={typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("status") ?? ""}
        options={[{ value: "", label: "전체" }, { value: "operational", label: "운영 중" }, { value: "maintenance", label: "유지보수 중" }, { value: "retired", label: "퇴역" }]}
        onChange={event => window.location.assign(event.target.value ? `/?status=${encodeURIComponent(event.target.value)}` : "/")} />}
      {state.assets.length === 0 ? <Alert text="조건에 맞는 자산이 없습니다." /> :
        <Table caption="IT 자산 목록" columns={["자산 ID", "시스템명", "유형", "상태", "담당팀 ID"]}
          rows={state.assets.map(asset => [<Link key={asset.asset_id} href={`/?asset_id=${encodeURIComponent(asset.asset_id)}`} text={asset.asset_id} />, asset.name, asset.system_type, asset.status, asset.team_id])} />}
      {state.detail && <Card title="자산 상세" body={`${state.detail.asset.site} · 중요도 ${state.detail.asset.criticality}`}>
        <Card title="변경 요청" headingLevel={3}>
          {state.detail.changes.error !== undefined ? <Alert tone="danger" text={`변경 요청: ${state.detail.changes.error}`} /> :
            state.detail.changes.data.length === 0 ? <Alert text="등록된 변경 요청 없음" /> :
              <Table caption="변경 요청" columns={["변경 ID", "대상 자산", "담당팀", "제목", "상태", "위험", "계획일"]}
                rows={state.detail.changes.data.map(row => [row.change_id, row.asset_id, row.team_id, row.title, row.status, row.risk, row.planned_date])} />}
        </Card>
        <Card title="유지보수 일정" headingLevel={3}>
          {state.detail.windows.error !== undefined ? <Alert tone="danger" text={`유지보수 일정: ${state.detail.windows.error}`} /> :
            state.detail.windows.data.length === 0 ? <Alert text="예정된 유지보수 없음" /> :
              <Table caption="유지보수 일정" columns={["일정 ID", "대상 자산", "시작(KST)", "종료(KST)", "영향", "상태"]}
                rows={state.detail.windows.data.map(row => [row.window_id, row.asset_id, row.start, row.end, row.impact, row.status])} />}
        </Card>
        <Card title="담당팀" headingLevel={3}>
          {state.detail.teams.error !== undefined ? <Alert tone="danger" text={`담당팀: ${state.detail.teams.error}`} /> :
            state.detail.teams.data.length === 0 ? <Alert text="담당팀 정보 없음" /> :
              <Table caption="담당팀" columns={["담당팀 ID", "팀명", "가상 연락처", "지원시간"]}
                rows={state.detail.teams.data.map(row => [row.team_id, row.name, row.contact, row.support_hours])} />}
        </Card>
      </Card>}
    </>}
  </Card>;
}
