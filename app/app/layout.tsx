import type { ReactNode } from "react";
import { headers } from "next/headers";
import Script from "next/script";
import { themeScript } from "@hy2219/custom-ui";
import "@hy2219/custom-ui/theme.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <html lang="ko" suppressHydrationWarning>
    <head><Script id="custom-ui-theme" nonce={nonce} strategy="beforeInteractive">{themeScript}</Script></head>
    <body>{children}</body>
  </html>;
}
