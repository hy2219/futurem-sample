import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

test("demo user signs in, reads four IT assets and signs out", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(process.env.APP_URL ?? "http://127.0.0.1:3100");
    await page.getByRole("link", { name: "데모 로그인" }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    assert.equal(await page.getByRole("row").count(), 5);
    for (const id of ["AST-001", "AST-002", "AST-003", "AST-004"]) {
      assert.equal(await page.getByRole("cell", { name: id, exact: true }).count(), 1);
    }
    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.getByRole("link", { name: "데모 로그인" }).waitFor();
    assert.equal(await page.getByRole("table").count(), 0);
  } finally {
    await browser.close();
  }
});

test("app auth rejects forged callbacks, expired/tampered sessions and cross-origin logout", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    assert.equal((await context.request.get(`${origin}/api/assets`)).status(), 401);
    assert.equal((await context.request.get(`${origin}/auth/callback?state=wrong&code=wrong`)).status(), 400);
    assert.equal((await context.request.post(`${origin}/auth/logout`, { headers: { Origin: "https://example.com" } })).status(), 403);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "simplified-sdlc-sso", aud: process.env.APP_CLIENT_ID, sub: "demo",
      name: "Demo User", mock: true, exp: now - 1, iat: now - 901, jti: "expiry-e2e",
    })).toString("base64url");
    const expired = `${header}.${payload}.${createHmac("sha256", process.env.SSO_SESSION_KEY ?? "").update(`${header}.${payload}`).digest("base64url")}`;
    for (const value of [expired, `${expired}tampered`]) {
      await context.addCookies([{ name: "demo_session", value, url: origin, httpOnly: true, sameSite: "Lax" }]);
      assert.equal((await context.request.get(`${origin}/api/assets`)).status(), 401);
    }
    await context.clearCookies();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인" }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    const session = (await context.cookies()).find(value => value.name === "demo_session");
    assert.ok(session?.httpOnly && session.sameSite === "Lax" && !session.secure);
    assert.ok(!(await context.cookies()).some(value => value.name === "demo_login"));
    assert.equal(new URL(page.url()).search, "");
    assert.equal((await context.request.post(`${origin}/auth/logout`, { headers: { Origin: "null" } })).status(), 403);
    assert.equal((await context.request.get(`${origin}/api/assets`)).status(), 200);
  } finally {
    await browser.close();
  }
});

test("UI boundary fixtures expose resource and section failures rather than empty-result success", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인" }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    const actual = await page.request.get(`${origin}/api/assets?asset_id=AST-001`);
    const detail = await actual.json();
    detail.detail.changes = { error: "리소스 조회에 실패했습니다." };
    await page.route("**/api/assets?asset_id=AST-001", route => route.fulfill({ json: detail }));
    await page.goto(`${origin}/?asset_id=AST-001`);
    await page.getByRole("alert").filter({ hasText: "변경 요청: 리소스 조회에 실패했습니다." }).waitFor();
    assert.equal(await page.getByText("등록된 변경 요청 없음", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("cell", { name: "MW-001", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "quality-demo@example.com", exact: true }).count(), 1);
    await page.route("**/api/assets", route => route.fulfill({ status: 502, json: { error: "자산 리소스 조회에 실패했습니다." } }));
    await page.goto(origin);
    await page.getByRole("alert").filter({ hasText: "자산 리소스 조회에 실패했습니다." }).waitFor();
    assert.equal(await page.getByText("조건에 맞는 자산이 없습니다.", { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});

test("asset status filters distinguish empty results, reject invalid input, and reset to all four", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인" }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByLabel("자산 상태").selectOption("operational");
    await page.waitForURL("**/?status=operational");
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    assert.equal(await page.getByRole("table", { name: "IT 자산 목록" }).getByRole("row").count(), 4);
    await page.getByLabel("자산 상태").selectOption("maintenance");
    await page.waitForURL("**/?status=maintenance");
    await page.getByRole("cell", { name: "AST-003", exact: true }).waitFor();
    assert.equal(await page.getByRole("table", { name: "IT 자산 목록" }).getByRole("row").count(), 2);
    await page.getByLabel("자산 상태").selectOption("retired");
    await page.getByText("조건에 맞는 자산이 없습니다.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("table").count(), 0);
    await page.getByRole("link", { name: "전체 자산", exact: true }).click();
    await page.getByRole("table", { name: "IT 자산 목록" }).waitFor();
    assert.equal(await page.getByRole("row").count(), 5);
    for (const search of ["?status=unknown", "?asset_id=", "?status=retired&status=operational", "?sql=SELECT"]) {
      await page.goto(`${origin}/${search}`);
      await page.getByText("잘못된 조회 조건입니다.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("table").count(), 0);
    }
  } finally {
    await browser.close();
  }
});

test("asset details join stable IDs across all four resources and distinguish missing from empty", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
    await page.goto(origin);
    await page.getByRole("link", { name: "데모 로그인" }).click();
    await page.getByLabel("데모 사용자").fill("demo");
    await page.getByLabel("데모 비밀번호").fill("demo1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("link", { name: "AST-001", exact: true }).click();
    await page.getByRole("table", { name: "변경 요청", exact: true }).waitFor();
    assert.equal(await page.getByRole("table", { name: "변경 요청", exact: true }).getByRole("row").count(), 3);
    assert.equal(await page.getByRole("cell", { name: "CHG-001", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "CHG-004", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "MW-001", exact: true }).count(), 1);
    assert.equal(await page.getByRole("cell", { name: "quality-demo@example.com", exact: true }).count(), 1);
    await page.goto(`${origin}/?asset_id=AST-003`);
    await page.getByRole("cell", { name: "materials-demo@example.com", exact: true }).waitFor();
    assert.equal(await page.getByRole("cell", { name: "가상 창고관리 시스템", exact: true }).count(), 1);
    await page.goto(`${origin}/?asset_id=AST-004`);
    await page.getByText("등록된 변경 요청 없음", { exact: true }).waitFor();
    await page.getByText("예정된 유지보수 없음", { exact: true }).waitFor();
    assert.equal(await page.getByRole("cell", { name: "quality-demo@example.com", exact: true }).count(), 1);
    await page.goto(`${origin}/?asset_id=missing`);
    await page.getByText("자산을 찾을 수 없습니다.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("table").count(), 0);
  } finally {
    await browser.close();
  }
});
