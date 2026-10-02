import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Provedores } from "@/components/layout/provedores";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Portal Guarese's ON",
    template: "%s · Portal Guarese's ON",
  },
  description: "Documentos, contabilidade e gestão financeira em um só lugar.",
  applicationName: "Portal Guarese's ON",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141110" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Provedores nonce={nonce}>{children}</Provedores>
      </body>
    </html>
  );
}
