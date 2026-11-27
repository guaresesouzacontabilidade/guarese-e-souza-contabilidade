import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Clock, Pause, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { criarClienteServidor } from "@/lib/supabase/server";
import { formatarDataHora, formatarTelefone } from "@/lib/formatos";
import { formatarEntrega } from "@/lib/os/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Acompanhe sua ordem de serviço", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Acompanhamento {
  numero: number;
  etapa: string;
  cliente: string;
  previsao: string | null;
  prazo: string | null;
  aberta_em: string;
  pronta_em: string | null;
  entregue_em: string | null;
  pausada: boolean;
  loja: string;
  telefone: string | null;
  servicos: string[];
}

const PASSOS = [
  { etapa: "fila", rotulo: "Recebida" },
  { etapa: "execucao", rotulo: "Em execução" },
  { etapa: "pronta", rotulo: "Pronta para retirada" },
  { etapa: "entregue", rotulo: "Entregue" },
];

/**
 * Acompanhamento da OS pelo cliente (link do QR Code, sem login). Mostra só o
 * número, a etapa, a previsão e o primeiro nome — sem telefone, documento ou valor.
 */
export default async function AcompanharOs({ params }: PageProps<"/acompanhar/[codigo]">) {
  const { codigo } = await params;
  if (!/^[a-z0-9]{12}$/.test(codigo)) notFound();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("os_acompanhar", { p_codigo: codigo });
  const a = data as unknown as Acompanhamento | null;
  if (!a) notFound();
  const atual = a.etapa === "cancelada" ? -1 : PASSOS.findIndex((p) => p.etapa === a.etapa);
  const entrega = a.prazo ?? a.previsao;

  return (
    <Card className="w-full max-w-md">
      <meta httpEquiv="refresh" content="120" />
      <CardHeader className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{a.loja}</p>
        <CardTitle className="text-xl">Ordem de serviço nº {a.numero}</CardTitle>
        <p className="text-sm text-muted-foreground">Olá, {a.cliente}! Veja como está o seu serviço.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {a.etapa === "cancelada" ? (
          <p className="rounded-lg bg-perigo-bg p-3 text-center text-sm text-perigo-fg">Esta OS foi cancelada. Fale com a loja.</p>
        ) : (
          <ol className="space-y-3" aria-label="Andamento">
            {PASSOS.map((p, i) => {
              const feito = i < atual || (i === atual && p.etapa === "entregue");
              const agora = i === atual && p.etapa !== "entregue";
              return (
                <li key={p.etapa} className="flex items-center gap-3" aria-current={agora ? "step" : undefined}>
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                      feito && "border-sucesso bg-sucesso text-white",
                      agora && "border-primary bg-primary/10 text-primary",
                      !feito && !agora && "border-border text-muted-foreground",
                    )}
                  >
                    {feito ? <Check className="size-4" /> : agora && a.pausada ? <Pause className="size-4" /> : i + 1}
                  </span>
                  <span className={cn("text-sm", agora ? "font-semibold" : feito ? "" : "text-muted-foreground")}>
                    {p.rotulo}
                    {agora && a.pausada ? " (pausada por um momento)" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
          {a.etapa === "entregue" && a.entregue_em ? (
            <p>Entregue em {formatarDataHora(a.entregue_em)}. Obrigado!</p>
          ) : a.etapa === "pronta" && a.pronta_em ? (
            <p className="font-medium text-sucesso">Pronta desde {formatarEntrega(a.pronta_em)}. Pode retirar!</p>
          ) : entrega && a.etapa !== "cancelada" ? (
            <p className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden /> {a.prazo ? "Prazo de entrega" : "Previsão"}: <strong>{formatarEntrega(entrega)}</strong>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">Aberta em {formatarDataHora(a.aberta_em)}</p>
        </div>
        {a.servicos.length ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Serviços</p>
            <ul className="list-disc pl-5 text-sm">
              {a.servicos.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {a.telefone ? (
          <a href={`tel:+55${a.telefone}`} className="flex items-center justify-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline">
            <Phone className="size-4" aria-hidden /> Falar com a loja: {formatarTelefone(a.telefone)}
          </a>
        ) : null}
        <p className="text-center text-[11px] text-muted-foreground">Esta página se atualiza sozinha.</p>
      </CardContent>
    </Card>
  );
}
