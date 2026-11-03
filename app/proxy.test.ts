import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "./proxy.js";

test("dynamic Next.js responses use fresh nonce CSP and preserve same-origin forms", () => {
  const request = new NextRequest("https://app.example/");
  const first = proxy(request);
  const second = proxy(request);
  const policy = first.headers.get("Content-Security-Policy") ?? "";
  assert.match(policy, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  assert.notEqual(policy, second.headers.get("Content-Security-Policy"));
  assert.equal(first.headers.get("Referrer-Policy"), "same-origin");
  assert.equal(first.headers.get("Cache-Control"), "no-store");
});
