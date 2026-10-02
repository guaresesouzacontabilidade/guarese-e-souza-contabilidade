"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Provedores({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{ classNames: { toast: "font-sans" } }}
      />
    </ThemeProvider>
  );
}
