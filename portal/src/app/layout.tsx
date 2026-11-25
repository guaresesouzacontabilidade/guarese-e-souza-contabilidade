import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Provedores } from "@/components/layout/provedores";
import { BORDAO_SISTEMA, NOME_SISTEMA } from "@/lib/marca/sistema";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: NOME_SISTEMA,
    template: `%s · ${NOME_SISTEMA}`,
  },
  description: BORDAO_SISTEMA,
  applicationName: NOME_SISTEMA,
  robots: { index: false, follow: false },
  // Aberto pelo ícone da tela inicial, o portal ocupa a tela inteira (no iPhone,
  // é assim que as notificações no aparelho ficam disponíveis).
  appleWebApp: { capable: true, title: NOME_SISTEMA, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#070a12" },
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
