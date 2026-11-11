"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Achado, ResultadoConferencia } from "@/lib/escalas/conferencia";

const VISUAL = {
  erro: { icone: XCircle, classe: "text-perigo", rotulo: "Fora da regra" },
  alerta: { icone: AlertTriangle, classe: "text-alerta-fg", rotulo: "Atenção" },
  info: { icone: Info, classe: "text-info-fg", rotulo: "Para saber" },
} as const;

export function ResumoConferencia({ r }: { r: ResultadoConferencia }) {
  if (!r.erros && !r.alertas)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-sucesso-fg">
        <CheckCircle2 className="size-4" /> Dentro das regras da CLT conferidas pelo portal.
      </p>
    );
  return (
    <p className="text-sm">
      {r.erros ? <span className="font-semibold text-perigo">{r.erros} fora da regra</span> : null}
      {r.erros && r.alertas ? " · " : null}
      {r.alertas ? <span className="font-semibold text-alerta-fg">{r.alertas} para atenção</span> : null}
    </p>
  );
}

export function ListaConferencia({ r, aoEscolher, nomes }: { r: ResultadoConferencia; aoEscolher?: (a: Achado) => void; nomes?: Map<string, string> }) {
  if (!r.achados.length)
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-sucesso-fg">
        <CheckCircle2 className="size-4" /> Nada a apontar nesta escala.
      </p>
    );
  return (
    <ul className="space-y-2">
      {r.achados.map((a, i) => {
        const v = VISUAL[a.gravidade];
        const Icone = v.icone;
        const clicavel = Boolean(aoEscolher && (a.pessoaId || a.dia));
        const conteudo = (
          <>
            <Icone className={cn("mt-0.5 size-4 shrink-0", v.classe)} aria-hidden />
            <span className="min-w-0">
              <span className="sr-only">{v.rotulo}: </span>
              <span className="block font-medium text-foreground">{a.titulo}</span>
              <span className="block text-muted-foreground">{a.detalhe}</span>
              {a.base ? <span className="mt-0.5 block text-xs text-muted-foreground">Base: {a.base}</span> : null}
              {nomes && a.pessoaId && !a.titulo.includes(nomes.get(a.pessoaId) ?? "§") ? <span className="block text-xs">{nomes.get(a.pessoaId)}</span> : null}
            </span>
          </>
        );
        return (
          <li key={i}>
            {clicavel ? (
              <button type="button" onClick={() => aoEscolher!(a)} className="flex w-full items-start gap-2 rounded-lg border border-border p-3 text-left text-sm hover:bg-muted">
                {conteudo}
              </button>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">{conteudo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
