/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/** URL pública da logomarca enviada nas configurações (bucket "marca"). */
export function urlLogo(logoPath: string | null | undefined, atualizadoEm?: string | null) {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const v = atualizadoEm ? `?v=${encodeURIComponent(atualizadoEm)}` : "";
  return `${base}/storage/v1/object/public/marca/${logoPath}${v}`;
}

/**
 * Logomarca do escritório. Usa a logo enviada em Configurações quando existir;
 * caso contrário, a logomarca provisória. Proporções sempre preservadas.
 */
export function Logo({
  logoUrl,
  tom = "escuro",
  className,
  somenteSimbolo = false,
}: {
  logoUrl?: string | null;
  tom?: "escuro" | "claro";
  className?: string;
  somenteSimbolo?: boolean;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="Guarese's ON Contabilidade"
        className={cn("h-10 w-auto max-w-full object-contain", className)}
      />
    );
  }
  const src = somenteSimbolo ? "/marca/simbolo-on.svg" : tom === "claro" ? "/marca/logo-provisoria-clara.svg" : "/marca/logo-provisoria.svg";
  return <img src={src} alt="Guarese's ON Contabilidade" className={cn("h-10 w-auto max-w-full object-contain", className)} />;
}
