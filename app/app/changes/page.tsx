"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card, Link, Progress, Table, type Tone } from "@hy2219/custom-ui/react";
import type { Change, ChangeBoard } from "../../resources/client";

type State = { kind: "loading" | "unauthenticated" } | { kind: "error"; message: string } |
  { kind: "ready"; board: ChangeBoard; selectedId: string | null };
const risks: Record<Change["risk"], { label: string; tone: Tone }> = {
  high: { label: "고위험", tone: "danger" },
  medium: { label: "중위험", tone: "warning" },
  low: { label: "저위험", tone: "neutral" },
};
const approvals: Record<Change["status"], { label: string; tone: Tone }> = {
  requested: { label: "승인 대기 (요청)", tone: "warning" },
  approved: { label: "승인됨", tone: "success" },
  completed: { label: "완료", tone: "neutral" },
};
const assetStates: Record<string, string> = { operational: "운영 중", maintenance: "유지보수 중", retired: "퇴역" };
const criticalities: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };

export default function ChangeBoardPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/changes${window.location.search}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { setState({ kind: "unauthenticated" }); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "변경 점검 정보를 조회하지 못했습니다.");
        setState({ kind: "ready", board: body, selectedId: new URLSearchParams(window.location.search).get("change_id") });
      } catch (error) {
        if (!controller.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "서버에 연결할 수 없습니다." });
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const board = state.kind === "ready" ? state.board : undefined;
  const selected = state.kind === "ready" ? board?.changes.data?.find(row => row.change_id === state.selectedId) : undefined;
  const asset = board?.assets.data?.find(row => row.asset_id === selected?.asset_id);
  const team = board?.teams.data?.find(row => row.team_id === selected?.team_id);

  return <Card title="변경 점검 보드" body="합성 제조 IT 데이터 · 읽기 전용 · 완료된 변경은 제외합니다.">
    <Link href="/" text="전체 자산" />
    <Link href="/changes" text="변경 점검 보드" />
    {state.kind === "loading" && <Alert text="변경 정보를 조회하는 중" />}
    {state.kind === "unauthenticated" && <Card title="데모 로그인 안내" body="Mock SSO로 로그인하면 변경 점검 보드를 조회할 수 있습니다.">
      <Link href="/auth/login" text="데모 로그인" />
    </Card>}
    {state.kind === "error" && <Alert tone="danger" heading="조회 오류" text={state.message} />}
    {board && <>
      <Card title="1. 전체 현황" body="모든 집계와 위험도 비중은 미완료 변경 기준입니다. 승인 대기는 아직 요청 상태인 변경입니다.">
        {board.changes.error !== undefined ? <Alert tone="danger" text={`변경 조회 실패: ${board.changes.error} 현황을 집계할 수 없습니다.`} /> :
          board.summary && <>
            <Card title="미완료 변경" headingLevel={3} body={`${board.summary.incomplete}건`} />
            <Card title="고위험 변경" headingLevel={3} body={`${board.summary.high}건`} />
            <Card title="승인 대기" headingLevel={3} body={`${board.summary.pending}건`} />
            <Table caption="미완료 변경 위험도 분포" columns={["위험도", "건수", "비중", "비중 표시"]}
              rows={board.summary.risks.map(row => [
                <Badge key={row.risk} tone={risks[row.risk].tone} text={risks[row.risk].label} />,
                `${row.count}건`, board.summary?.incomplete ? `${row.percent.toFixed(1)}%` : "해당 없음",
                board.summary?.incomplete ? <Progress key={row.risk} id={`risk-${row.risk}`} label={`${risks[row.risk].label} 비중`}
                  value={row.count} max={board.summary.incomplete} /> : "미완료 변경 없음",
              ])} />
          </>}
      </Card>
      <Card title="2. 우선 확인할 변경" body="위험도 높은 순 → 같은 위험도에서는 변경 계획일 빠른 순입니다. 변경명을 선택하세요.">
        {board.assets.error !== undefined && <Alert tone="danger" text={`시스템 조회 실패: ${board.assets.error}`} />}
        {board.teams.error !== undefined && <Alert tone="danger" text={`담당팀 조회 실패: ${board.teams.error}`} />}
        {board.changes.error !== undefined ? <Alert tone="danger" text={`변경 조회 실패: ${board.changes.error}`} /> :
          board.changes.data.length === 0 ? <Alert text="미완료 변경이 없습니다." /> :
            <Table caption="미완료 변경 우선순위" columns={["변경명", "대상 시스템명", "담당팀명", "위험도", "승인 상태", "변경 계획일"]}
              rows={board.changes.data.map(row => [
                <Link key={row.change_id} href={`/changes?change_id=${encodeURIComponent(row.change_id)}`} text={row.title}
                  aria-current={row.change_id === selected?.change_id ? "true" : undefined} />,
                board.assets.error !== undefined ? `조회 실패 (${row.asset_id})` :
                  board.assets.data.find(item => item.asset_id === row.asset_id)?.name ?? `등록 정보 없음 (${row.asset_id})`,
                board.teams.error !== undefined ? `조회 실패 (${row.team_id})` :
                  board.teams.data.find(item => item.team_id === row.team_id)?.name ?? `등록 정보 없음 (${row.team_id})`,
                <Badge key="risk" tone={risks[row.risk].tone} text={risks[row.risk].label} />,
                <Badge key="approval" tone={approvals[row.status].tone} text={approvals[row.status].label} />,
                row.planned_date,
              ])} />}
      </Card>
      <Card title="3. 작업 전 관련 정보" body="변경 계획일과 등록된 점검 일정은 별개입니다. 시간 충돌이나 작업 가능 여부를 판정하지 않습니다.">
        {!selected ? <Alert text={state.kind === "ready" && state.selectedId && board.changes.data ?
          "선택한 미완료 변경을 찾을 수 없습니다." : "우선순위 목록에서 변경을 선택하세요."} /> : <>
          <Table caption="선택한 변경" columns={["변경 ID", "변경명", "대상 자산 ID", "담당팀 ID", "변경 계획일"]}
            rows={[[selected.change_id, selected.title, selected.asset_id, selected.team_id, selected.planned_date]]} />
          <Card title="대상 시스템" headingLevel={3}>
            {board.assets.error !== undefined ? <Alert tone="danger" text={`시스템 조회 실패: ${board.assets.error}`} /> :
              !asset ? <Alert text="등록된 대상 시스템 정보 없음" /> :
                <Table caption="대상 시스템 정보" columns={["시스템명", "사업장", "시스템 상태", "중요도"]}
                  rows={[[asset.name, asset.site, assetStates[asset.status] ?? asset.status, criticalities[asset.criticality] ?? asset.criticality]]} />}
          </Card>
          <Card title="등록된 점검 일정" headingLevel={3}>
            {board.windows?.error !== undefined ? <Alert tone="danger" text={`점검 일정 조회 실패: ${board.windows.error}`} /> :
              !board.windows ? <Alert tone="danger" text="점검 일정 정보를 조회하지 못했습니다." /> :
                board.windows.data.length === 0 ? <Alert text="등록된 점검 일정 없음" /> :
                  <Table caption="시스템 점검 일정" columns={["일정 ID", "점검 시작(KST)", "점검 종료(KST)", "업무 영향", "일정 상태"]}
                    rows={board.windows.data.map(row => [row.window_id, row.start, row.end, row.impact, row.status === "scheduled" ? "예정" : row.status])} />}
          </Card>
          <Card title="담당팀 연락 정보" headingLevel={3}>
            {board.teams.error !== undefined ? <Alert tone="danger" text={`담당팀 조회 실패: ${board.teams.error}`} /> :
              !team ? <Alert text="등록된 담당팀 정보 없음" /> :
                <Table caption="담당팀 연락 정보" columns={["담당팀명", "가상 연락처", "지원시간"]}
                  rows={[[team.name, team.contact, team.support_hours]]} />}
          </Card>
        </>}
      </Card>
    </>}
  </Card>;
}
