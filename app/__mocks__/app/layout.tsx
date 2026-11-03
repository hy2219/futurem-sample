import type { ReactNode } from "react";

export const headers = vi.fn(async () => new Headers({ "x-nonce": "layout-test-nonce" }));

export default function Script({ id, nonce, children }: { id: string; nonce?: string; children: ReactNode }) {
  return <script id={id} nonce={nonce}>{children}</script>;
}
