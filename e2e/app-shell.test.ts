import assert from "node:assert/strict";
import { test } from "node:test";

test("the asset app serves real Next.js and the pinned React UI with a fresh CSP nonce", async () => {
  const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
  const response = await fetch(origin, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
  assert.ok(nonce, "Next.js responses must retain a per-request CSP nonce");
  assert.ok(html.includes("/_next/static/"), "Next.js must serve the application, not a manual HTML adapter");
  assert.ok(html.includes(`nonce="${nonce}"`), "Framework rendering must propagate the request nonce");
  assert.ok(html.includes('data-custom-ui-version="0.2.0"'));
  assert.ok(html.includes("제조 IT 시스템 조회"));
  assert.ok(html.includes("로그인 상태를 확인하는 중"));
  assert.ok(!html.includes("APP_CLIENT_SECRET"));
});
