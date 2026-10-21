import { CalendarCheck, FileUp, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

/**
 * Ilustração da tela de entrada: o símbolo do escritório no centro de órbitas,
 * com cartões flutuando sobre o que o portal faz. As órbitas cabem inteiras na
 * área do desenho e ficam paradas (girar a elipse larga a fazia sair da área e
 * ser cortada): as bolinhas é que percorrem a órbita maior e o anel tracejado,
 * que é um círculo, gira sem sair do lugar. Os cartões ficam nos cantos, fora
 * das linhas, para os círculos aparecerem completos. Só decoração (sem números
 * nem dados), nas cores do tema; fica parada para quem desliga as animações.
 */
const CARTOES = [
  { icone: FileUp, titulo: "Documentos", texto: "envie pelo celular", posicao: "left-0 top-0 flex", atraso: "0s", chip: "bg-sucesso-bg text-sucesso" },
  { icone: CalendarCheck, titulo: "Impostos e guias", texto: "prazos e avisos", posicao: "bottom-0 right-0 flex", atraso: "1.2s", chip: "bg-info-bg text-info" },
  // Em telas médias falta largura para dois cartões embaixo sem tocar um no outro.
  { icone: ReceiptText, titulo: "Notas fiscais", texto: "tudo em um só lugar", posicao: "bottom-0 left-0 hidden lg:flex", atraso: "0.6s", chip: "bg-secondary text-primary" },
];

export function IlustracaoEntrada({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative h-80", className)}>
      <svg viewBox="0 0 520 320" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="entrada-orbita" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--grafico-1)", stopOpacity: 0.9 }} />
            <stop offset="100%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0.25 }} />
          </linearGradient>
          <radialGradient id="entrada-nucleo">
            <stop offset="0%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0.45 }} />
            <stop offset="100%" style={{ stopColor: "var(--grafico-2)", stopOpacity: 0 }} />
          </radialGradient>
          {/* Trajeto das bolinhas: a mesma elipse da órbita maior */}
          <path id="entrada-trajeto" d="M 465 160 A 205 82 0 1 1 55 160 A 205 82 0 1 1 465 160 Z" />
        </defs>
        <circle cx="260" cy="160" r="118" fill="url(#entrada-nucleo)" className="respirar" />
        <ellipse cx="260" cy="160" rx="205" ry="82" fill="none" stroke="url(#entrada-orbita)" strokeWidth="1.5" />
        <g className="girar-reverso">
          <circle cx="260" cy="160" r="108" fill="none" stroke="url(#entrada-orbita)" strokeWidth="1" strokeDasharray="4 8" />
          <circle cx="260" cy="52" r="5" style={{ fill: "var(--grafico-3)" }} />
        </g>
        <circle cx="260" cy="160" r="78" fill="none" style={{ stroke: "var(--border)" }} />
        <circle r="6" className="ponto-orbita" style={{ fill: "var(--grafico-2)" }}>
          <animateMotion dur="18s" repeatCount="indefinite">
            <mpath href="#entrada-trajeto" />
          </animateMotion>
        </circle>
        <circle r="4" className="ponto-orbita" style={{ fill: "var(--grafico-1)" }}>
          <animateMotion dur="18s" begin="-9s" repeatCount="indefinite">
            <mpath href="#entrada-trajeto" />
          </animateMotion>
        </circle>
      </svg>
      <div className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl [background-image:var(--gradiente-selo)] shadow-[var(--brilho)] lg:size-24 lg:rounded-[28px]">
        <Logo versao="simbolo" tom="branco" className="h-8 lg:h-9" />
      </div>
      {CARTOES.map((c) => {
        const Icone = c.icone;
        return (
          <div
            key={c.titulo}
            className={cn("flutuar absolute items-center gap-2.5 rounded-2xl border border-border bg-card/85 px-3 py-2.5 shadow-[var(--sombra-card)] backdrop-blur-md", c.posicao)}
            style={{ animationDelay: c.atraso }}
          >
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", c.chip)}>
              <Icone className="size-4" />
            </span>
            <span className="flex flex-col whitespace-nowrap">
              <span className="text-sm font-semibold text-titulo">{c.titulo}</span>
              <span className="text-xs text-muted-foreground">{c.texto}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
