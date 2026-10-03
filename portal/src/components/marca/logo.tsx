/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/** URL pública da logomarca enviada nas configurações (bucket "marca"). */
export function urlLogo(logoPath: string | null | undefined, atualizadoEm?: string | null) {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const v = atualizadoEm ? `?v=${encodeURIComponent(atualizadoEm)}` : "";
  return `${base}/storage/v1/object/public/marca/${logoPath}${v}`;
}

/** Proporção (largura ÷ altura) de cada versão da logomarca oficial. */
const VERSOES = {
  horizontal: { arquivo: "/marca/logo-horizontal.svg", proporcao: 4.4757 },
  vertical: { arquivo: "/marca/logo-vertical.svg", proporcao: 1.486 },
  simbolo: { arquivo: "/marca/simbolo.svg", proporcao: 1.7784 },
} as const;

/**
 * Logomarca do escritório (GUARESE'S ON CONTABILIDADE). Usa a logo enviada em
 * Configurações quando existir; caso contrário, a logomarca oficial em vetor,
 * que acompanha a cor do texto (clara no menu escuro e no modo escuro).
 * Proporções sempre preservadas.
 */
export function Logo({
  logoUrl,
  tom = "escuro",
  versao = "horizontal",
  className,
}: {
  logoUrl?: string | null;
  tom?: "escuro" | "claro";
  versao?: keyof typeof VERSOES;
  className?: string;
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt="Guarese's ON Contabilidade" className={cn("h-10 w-auto max-w-full object-contain", className)} />;
  }
  const v = VERSOES[versao];
  const mascara = `url(${v.arquivo}) center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={versao === "simbolo" ? "Guarese's ON" : "Guarese's ON Contabilidade"}
      className={cn("inline-block h-10 max-w-full shrink-0 bg-current", tom === "claro" ? "text-sidebar-foreground" : "text-titulo", className)}
      style={{ aspectRatio: v.proporcao, WebkitMask: mascara, mask: mascara }}
    />
  );
}
