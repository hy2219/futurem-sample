import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page.js";

test("the read-only asset page uses the approved UI and a visible loading state without secrets", () => {
  const html = renderToStaticMarkup(<Home />);
  assert.ok(html.includes("제조 IT 시스템 조회"));
  assert.ok(html.includes("로그인 상태를 확인하는 중"));
  assert.ok(html.includes('data-custom-ui="card"'));
  assert.ok(html.includes('data-custom-ui-version="0.2.0"'));
  assert.ok(!html.includes("demo1234"));
});
