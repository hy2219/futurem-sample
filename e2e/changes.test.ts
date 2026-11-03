import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

test("operator opens the change board, prioritizes incomplete work and checks related information", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    assert.equal((await page.request.get(`${origin}/api/changes`)).status(), 401);
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인", exact: true }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    await page.getByRole("link", { name: "변경 점검 보드", exact: true }).click();
    await page.getByRole("heading", { name: "1. 전체 현황", exact: true }).waitFor();
    for (const [title, count] of [["미완료 변경", "3건"], ["고위험 변경", "1건"], ["승인 대기", "1건"]]) {
      const card = page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).last();
      assert.ok((await card.innerText()).includes(count));
    }
    const list = page.getByRole("table", { name: "미완료 변경 우선순위" });
    assert.equal(await list.getByRole("row").count(), 4);
    const links = list.getByRole("link");
    assert.deepEqual(await links.allTextContents(), ["가상 생산 집계 배치 조정", "가상 분석 기준표 갱신", "가상 창고 조회 인덱스 점검"]);
    assert.equal(await page.getByText("가상 분석 보고서 문구 정비", { exact: true }).count(), 0);
    for (const risk of ["고위험", "중위험", "저위험"]) {
      const progress = page.getByRole("progressbar", { name: `${risk} 비중` });
      assert.equal(await progress.getAttribute("value"), "1");
      assert.equal(await progress.getAttribute("max"), "3");
    }
    await links.first().click();
    await page.getByRole("heading", { name: "3. 작업 전 관련 정보", exact: true }).waitFor();
    await page.getByRole("cell", { name: "production-demo@example.com", exact: true }).waitFor();
    assert.equal(await page.getByRole("cell", { name: "MW-002", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "가상 생산실적 시스템", exact: true }).count(), 2);
    assert.equal(await page.getByRole("cell", { name: "2026-11-08", exact: true }).count(), 2);
    assert.equal(await page.getByRole("columnheader", { name: "변경 계획일", exact: true }).count(), 2);
    assert.equal(await page.getByRole("columnheader", { name: "점검 시작(KST)", exact: true }).count(), 1);
    await page.getByRole("link", { name: "전체 자산", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    assert.equal(await page.getByRole("row").count(), 5);
  } finally {
    await browser.close();
  }
});

test("board UI distinguishes missing data, partial failures and unavailable totals", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인", exact: true }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    const actual = await (await page.request.get(`${origin}/api/changes?change_id=CHG-002`)).json();
    const failure = { error: "리소스 조회에 실패했습니다." };
    let response = { ...actual, assets: failure };
    await page.route("**/api/changes*", route => route.fulfill({ json: response }));
    await page.goto(`${origin}/changes?change_id=CHG-002`);
    await page.getByRole("alert").filter({ hasText: "시스템 조회 실패" }).first().waitFor();
    assert.equal(await page.getByRole("cell", { name: "MW-002", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "production-demo@example.com", exact: true }).count(), 1);
    assert.equal(await page.getByText("운영 중", { exact: true }).count(), 0);

    response = { ...actual, teams: failure, windows: failure };
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "점검 일정 조회 실패" }).waitFor();
    assert.equal(await page.getByRole("table", { name: "대상 시스템 정보", exact: true }).count(), 1);
    assert.equal(await page.getByText("등록된 점검 일정 없음", { exact: true }).count(), 0);
    assert.equal(await page.getByText("등록된 담당팀 정보 없음", { exact: true }).count(), 0);

    response = { ...actual, assets: { data: [] }, teams: { data: [] }, windows: { data: [] } };
    await page.reload();
    await page.getByText("등록된 점검 일정 없음", { exact: true }).waitFor();
    assert.equal(await page.getByText("등록된 대상 시스템 정보 없음", { exact: true }).count(), 1);
    assert.equal(await page.getByText("등록된 담당팀 정보 없음", { exact: true }).count(), 1);
    assert.equal(await page.locator('[data-custom-ui="alert"][data-tone="danger"]').count(), 0);

    response = { ...actual, changes: failure, summary: undefined };
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "현황을 집계할 수 없습니다." }).waitFor();
    assert.equal(await page.getByText("0건", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("progressbar").count(), 0);
    assert.equal(await page.getByText("미완료 변경이 없습니다.", { exact: true }).count(), 0);

    response = { ...actual, changes: { data: [] }, summary: {
      incomplete: 0, high: 0, pending: 0, risks: ["high", "medium", "low"].map(risk => ({ risk, count: 0, percent: 0 })),
    } };
    await page.goto(`${origin}/changes`);
    await page.getByText("미완료 변경이 없습니다.", { exact: true }).waitFor();
    assert.equal(await page.getByText("0건", { exact: true }).count(), 6);
    assert.equal(await page.getByRole("progressbar").count(), 0);

    await page.unroute("**/api/changes*");
    await page.goto(`${origin}/changes?change_id=CHG-004`);
    await page.getByText("선택한 미완료 변경을 찾을 수 없습니다.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("table", { name: "선택한 변경", exact: true }).count(), 0);
    await page.goto(`${origin}/changes?change_id=`);
    await page.getByText("잘못된 조회 조건입니다.", { exact: true }).waitFor();
    assert.equal(await page.getByText("0건", { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});
