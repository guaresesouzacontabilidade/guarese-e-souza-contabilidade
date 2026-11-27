"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import type { ResultadoAcao } from "@/lib/acoes";
import { DialogoAcao, type Acao, type LinhaTitulo } from "@/components/financeiro/lista-titulos";

export type Urgente = {
  id: string;
  tipo: "pagar" | "receber";
  descricao: string;
  vencimento: string;
  saldo: number;
  situacao: string;
  aprovacao_status: string;
  contraparte: string | null;
  dias_atraso: number;
};

/**
 * Pendências que se resolvem aqui mesmo: vencidos e o que vence nos próximos
 * dias, com o botão de pagar/receber (ou aprovar) em cada item.
 */
export function PendenciasPainel({
  empresaId,
  itens,
  hoje,
  permissoes,
  contas,
}: {
  empresaId: string;
  itens: Urgente[];
  hoje: string;
  permissoes: { baixar: boolean; aprovar: boolean };
  contas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [acao, setAcao] = React.useState<{ tipo: Acao; item: Urgente } | null>(null);

  function concluido(r: ResultadoAcao) {
    if (r.ok) {
      toast.success(r.mensagem ?? "Feito.");
      setAcao(null);
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível concluir.");
    return false;
  }

  if (!itens.length) return <p className="text-sm text-muted-foreground">Nada vencido nem vencendo nos próximos 3 dias. 👍</p>;

  return (
    <>
      <ul className="divide-y divide-border" data-testid="pendencias-painel">
        {itens.map((u) => {
          const aguardando = u.tipo === "pagar" && (u.aprovacao_status === "pendente" || u.aprovacao_status === "reprovado");
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={`/e/${empresaId}/financeiro/${u.tipo}/${u.id}`} className="block truncate font-medium hover:underline">
                  {u.descricao}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variante={u.tipo === "receber" ? "sucesso" : "neutro"}>{u.tipo === "receber" ? "A receber" : "A pagar"}</Badge>
                  {u.dias_atraso > 0 ? (
                    <Badge variante="perigo">vencido há {u.dias_atraso} dia(s)</Badge>
                  ) : u.vencimento === hoje ? (
                    <Badge variante="alerta">vence hoje</Badge>
                  ) : (
                    <span>vence {formatarData(u.vencimento)}</span>
                  )}
                  {u.contraparte ? <span className="truncate">{u.contraparte}</span> : null}
                  {aguardando ? <Badge variante="alerta">{u.aprovacao_status === "pendente" ? "aguardando aprovação" : "reprovado"}</Badge> : null}
                </span>
              </div>
              <span className={`numero font-semibold ${u.tipo === "receber" ? "text-sucesso" : "text-perigo"}`}>
                {u.tipo === "receber" ? "+" : "−"} {formatarMoeda(u.saldo)}
              </span>
              {aguardando && permissoes.aprovar && u.aprovacao_status === "pendente" ? (
                <Button tamanho="sm" variante="sucesso" onClick={() => setAcao({ tipo: "aprovar", item: u })}>
                  <ShieldCheck /> Aprovar
                </Button>
              ) : !aguardando && permissoes.baixar ? (
                <Button tamanho="sm" variante="contorno" onClick={() => setAcao({ tipo: "baixar", item: u })}>
                  <HandCoins /> {u.tipo === "pagar" ? "Pagar" : "Receber"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {acao ? (
        <DialogoAcao
          key={`${acao.tipo}-${acao.item.id}`}
          empresaId={empresaId}
          pagar={acao.item.tipo === "pagar"}
          acao={acao.tipo}
          titulos={[comoLinha(acao.item)]}
          hoje={hoje}
          contas={contas}
          categorias={[]}
          centros={[]}
          aoFechar={() => setAcao(null)}
          aoConcluir={concluido}
        />
      ) : null}
    </>
  );
}

function comoLinha(u: Urgente): LinhaTitulo {
  return {
    id: u.id,
    descricao: u.descricao,
    categoria: null,
    contraparte: u.contraparte,
    centro: null,
    competencia: u.vencimento,
    vencimento: u.vencimento,
    valor: u.saldo.toFixed(2),
    pago: "0",
    saldo: u.saldo.toFixed(2),
    situacao: u.situacao,
    vencido: u.dias_atraso > 0,
    diasAtraso: u.dias_atraso,
    revisao: "confirmado",
    origem: "manual",
    parcela: null,
    aprovacao: u.aprovacao_status,
    acordo: false,
    recorrente: false,
  };
}
