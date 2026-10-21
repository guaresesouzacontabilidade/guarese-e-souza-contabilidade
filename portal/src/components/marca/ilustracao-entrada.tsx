import { CalendarCheck, FileUp, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

/**
 * Ilustração da tela de entrada: o símbolo do escritório no centro de órbitas
 * que giram devagar, com cartões flutuando sobre o que o portal faz. Só
 * decoração (sem números nem dados), nas cores do tema; fica parada para quem
 * desliga as animações no aparelho.
 */
const CARTOES = [
  { icone: FileUp, titulo: "Documentos", texto: "enviados pelo celular ou computador", posicao: "left-0 top-[4%]", atraso: "0s", chip: "bg-sucesso-bg text-sucesso" },
  { icone: CalendarCheck, titulo: "Impostos e guias", texto: "com prazos e avisos", posicao: "right-0 top-[40%]", atraso: "1.2s", chip: "bg-info-bg text-info" },
  { icone: ReceiptText, titulo: "Notas fiscais", texto: "organizadas em um só lugar", posicao: "bottom-[2%] left-[6%]", atraso: "0.6s", chip: "bg-secondary text-primary" },
];

export function IlustracaoEntrada({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative h-72", className)}>
      <svg viewBox="0 0 520 300" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="entrada-orbita" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--grafico-1)", stopOpacity: 0.9 }} />
            <stop offset="100%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0.25 }} />
          </linearGradient>
          <radialGradient id="entrada-nucleo">
            <stop offset="0%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0.45 }} />
            <stop offset="100%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <circle cx="260" cy="150" r="120" fill="url(#entrada-nucleo)" className="respirar" />
        <g className="girar-lento">
          <ellipse cx="260" cy="150" rx="220" ry="92" fill="none" stroke="url(#entrada-orbita)" strokeWidth="1.5" />
          <circle cx="480" cy="150" r="6" style={{ fill: "var(--grafico-2)" }} />
          <circle cx="40" cy="150" r="4" style={{ fill: "var(--grafico-1)" }} />
        </g>
        <g className="girar-reverso">
          <ellipse cx="260" cy="150" rx="150" ry="132" fill="none" stroke="url(#entrada-orbita)" strokeWidth="1" strokeDasharray="4 8" />
          <circle cx="260" cy="18" r="5" style={{ fill: "var(--grafico-3)" }} />
        </g>
        <circle cx="260" cy="150" r="86" fill="none" style={{ stroke: "var(--border)" }} />
      </svg>
      <div className="absolute left-1/2 top-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[28px] [background-image:var(--gradiente-marca)] shadow-[var(--brilho)]">
        <Logo versao="simbolo" tom="branco" className="h-9" />
      </div>
      {CARTOES.map((c) => {
        const Icone = c.icone;
        return (
          <div
            key={c.titulo}
            className={cn("flutuar absolute flex items-center gap-2.5 rounded-2xl border border-border bg-card/85 px-3.5 py-3 shadow-[var(--sombra-card)] backdrop-blur-md", c.posicao)}
            style={{ animationDelay: c.atraso }}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", c.chip)}>
              <Icone className="size-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-titulo">{c.titulo}</span>
              <span className="text-xs text-muted-foreground">{c.texto}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
