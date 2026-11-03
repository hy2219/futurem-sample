import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "./layout.js";

vi.mock("next/headers", () => import("../__mocks__/app/layout.js"));
vi.mock("next/script", () => import("../__mocks__/app/layout.js"));

test("the root layout renders Korean content with the shared theme and per-request nonce", async () => {
  const tree = await RootLayout({ children: <main>Template content</main> });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes('lang="ko"'));
  assert.ok(html.includes("Template content"));
  assert.ok(html.includes("layout-test-nonce"));
});
