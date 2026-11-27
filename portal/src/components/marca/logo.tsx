/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { BORDAO_SISTEMA, NOME_SISTEMA } from "@/lib/marca/sistema";

/** URL pública da logomarca enviada nas configurações (bucket "marca"). */
export function urlLogo(logoPath: string | null | undefined, atualizadoEm?: string | null) {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const v = atualizadoEm ? `?v=${encodeURIComponent(atualizadoEm)}` : "";
  return `${base}/storage/v1/object/public/marca/${logoPath}${v}`;
}

/** Tamanho da logo (o texto acompanha o símbolo). */
const TAMANHOS = {
  sm: "text-[15px]",
  md: "text-[18px]",
  lg: "text-[23px]",
  xl: "text-[30px]",
} as const;

/**
 * Logomarca do sistema (Catarinense Tech): o símbolo da Catarinense com o nome
 * "CATARINENSE" e "TECH" embaixo. As cores do nome seguem o tema (verde e
 * vermelho no claro, branco e rosado no escuro). "horizontal": símbolo ao lado
 * do nome (menu e cabeçalhos); "vertical": empilhada, com o bordão opcional;
 * "simbolo": só o símbolo. Quando o escritório envia a própria logo em
 * Configurações, ela aparece no lugar (logoUrl).
 */
export function Logo({
  logoUrl,
  versao = "horizontal",
  tamanho = "md",
  bordao = false,
  className,
}: {
  logoUrl?: string | null;
  versao?: "horizontal" | "vertical" | "simbolo";
  tamanho?: keyof typeof TAMANHOS;
  bordao?: boolean;
  className?: string;
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt="Logo do escritório" className={cn("h-10 w-auto max-w-full object-contain", className)} />;
  }
  if (versao === "simbolo") {
    return <img src="/marca/simbolo.png" alt={NOME_SISTEMA} className={cn("h-10 w-auto object-contain", className)} />;
  }
  const nome = (
    <span className="font-marca font-bold leading-none tracking-[0.02em] text-[color:var(--marca-nome)]">CATARINENSE</span>
  );
  if (versao === "vertical") {
    return (
      <span role="img" aria-label={NOME_SISTEMA} className={cn("inline-flex flex-col items-center text-center", TAMANHOS[tamanho], className)}>
        <img src="/marca/simbolo.png" alt="" className="h-[3.4em] w-auto" />
        <span className="mt-[0.45em] text-[1.6em]">{nome}</span>
        <span className="mt-[0.4em] flex items-center gap-[0.6em] text-[0.62em] font-semibold tracking-[0.5em] text-[color:var(--marca-acento)] before:h-px before:w-[2.4em] before:bg-current after:h-px after:w-[2.4em] after:bg-current">
          <span className="-mr-[0.5em]">TECH</span>
        </span>
        {bordao ? <span className="mt-[0.7em] text-[0.72em] italic text-muted-foreground">{BORDAO_SISTEMA}</span> : null}
      </span>
    );
  }
  return (
    <span role="img" aria-label={NOME_SISTEMA} className={cn("inline-flex shrink-0 items-center gap-[0.55em]", TAMANHOS[tamanho], className)}>
      <img src="/marca/simbolo.png" alt="" className="h-[2.3em] w-auto" />
      <span className="flex flex-col">
        <span className="text-[1.15em]">{nome}</span>
        <span className="mt-[0.3em] text-[0.5em] font-bold leading-none tracking-[0.55em] text-[color:var(--marca-acento)]">TECH</span>
      </span>
    </span>
  );
}
