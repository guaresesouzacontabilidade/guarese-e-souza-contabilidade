import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Indicador, StatusIndicador } from "@/lib/relatorios/indicadores";

const ESTILO: Record<StatusIndicador, { borda: string; fundo: string; texto: string; rotulo: string; Icone: typeof CheckCircle2 }> = {
  bom: { borda: "border-sucesso/40", fundo: "bg-sucesso-bg", texto: "text-sucesso-fg", rotulo: "Saudável", Icone: CheckCircle2 },
  atencao: { borda: "border-alerta/50", fundo: "bg-alerta-bg", texto: "text-alerta-fg", rotulo: "Atenção", Icone: AlertTriangle },
  critico: { borda: "border-perigo/40", fundo: "bg-perigo-bg", texto: "text-perigo-fg", rotulo: "Crítico", Icone: XCircle },
  sem_dados: { borda: "border-border", fundo: "bg-muted", texto: "text-muted-foreground", rotulo: "Sem dados", Icone: CircleHelp },
};

/** Indicadores de saúde financeira com semáforo e explicação simples. */
export function CartoesSaude({ indicadores }: { indicadores: Indicador[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
      {indicadores.map((i) => {
        const e = ESTILO[i.status];
        return (
          <li key={i.chave} className={cn("flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm", e.borda)}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i.titulo}</p>
              <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", e.fundo, e.texto)}>
                <e.Icone className="size-3.5" aria-hidden /> {e.rotulo}
              </span>
            </div>
            <p className="text-xl font-bold numero text-titulo">{i.valor}</p>
            {i.detalhe ? <p className="text-xs text-muted-foreground numero">{i.detalhe}</p> : null}
            <p className="text-sm leading-relaxed text-foreground/90">{i.explicacao}</p>
          </li>
        );
      })}
    </ul>
  );
}
