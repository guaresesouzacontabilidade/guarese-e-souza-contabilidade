"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { BaixarNoCelular } from "./baixar-no-celular";
import { PresencaPortal } from "./presenca";

export function Provedores({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" themes={["light", "dark", "bronze", "grafite", "vidro"]} defaultTheme="vidro" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
      {/* Antes da presença: no celular, o clique no arquivo é tratado aqui e a aba não sai do portal */}
      <BaixarNoCelular />
      <PresencaPortal />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{ classNames: { toast: "font-sans" } }}
      />
    </ThemeProvider>
  );
}
