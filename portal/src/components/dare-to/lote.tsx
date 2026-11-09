"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Landmark, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { emitirDareComplementacaoEmpresa } from "@/lib/dare-to/acoes";
import { formatarMoeda } from "@/lib/dinheiro";

export interface CandidataDare {
  id: string;
  nome: string;
  valor: string;
}

interface Resultado {
  id: string;
  nome: string;
  ok: boolean;
  mensagem: string;
}

/**
 * Emite o DARE da complementação de todas as empresas prontas da carteira, uma
 * por vez (cada uma com a mesma conferência do botão da empresa). A página
 * conduz a fila: fechar a página interrompe as que faltam.
 */
export function EmitirDaresLote({ competencia, candidatas, bloqueio }: { competencia: string; candidatas: CandidataDare[]; bloqueio: string | null }) {
  const router = useRouter();
  const [atual, setAtual] = React.useState<string | null>(null);
  const [resultados, setResultados] = React.useState<Resultado[]>([]);
  const total = candidatas.reduce((s, c) => s + Number(c.valor), 0);
  const rodando = atual !== null;

  async function emitirTodas() {
    setResultados([]);
    for (const c of candidatas) {
      setAtual(c.nome);
      let r: Resultado;
      try {
        const x = await emitirDareComplementacaoEmpresa(c.id, competencia);
        r = { id: c.id, nome: c.nome, ok: x.ok, mensagem: x.mensagem ?? (x.ok ? "Emitido." : "Não foi possível emitir.") };
      } catch {
        r = { id: c.id, nome: c.nome, ok: false, mensagem: "A conexão caiu durante a emissão. Confira a empresa antes de tentar de novo." };
      }
      setResultados((ant) => [...ant, r]);
    }
    setAtual(null);
    router.refresh();
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {candidatas.length ? (
            <>
              <span className="font-medium">{candidatas.length}</span> {candidatas.length === 1 ? "empresa pronta" : "empresas prontas"} para emitir ({formatarMoeda(total)}). Prontas = apuração
              conferida, complementação a partir de R$ 3,00, vencimento ainda não passou e sem DARE emitido.
            </>
          ) : (
            "Nenhuma empresa pronta para emitir neste mês."
          )}
        </p>
        {candidatas.length ? (
          <Confirmacao
            gatilho={
              <Button disabled={Boolean(bloqueio) || rodando}>
                {rodando ? <Loader2 className="animate-spin" /> : <Landmark />} Emitir os DAREs ({candidatas.length})
              </Button>
            }
            titulo={`Emitir ${candidatas.length} ${candidatas.length === 1 ? "DARE" : "DAREs"} na SEFAZ-TO?`}
            descricao={`O robô emite um DARE por empresa (receita 105, vencimento do dia 9), no total de ${formatarMoeda(total)}, e publica cada PDF na empresa. Mantenha esta página aberta até terminar.`}
            textoConfirmar="Emitir"
            aoConfirmar={() => {
              void emitirTodas();
            }}
          />
        ) : null}
      </div>
      {bloqueio ? <p className="text-muted-foreground">{bloqueio}</p> : null}
      {rodando ? (
        <p className="flex items-center gap-2" role="status">
          <Loader2 className="size-4 animate-spin" /> Emitindo {resultados.length + 1} de {candidatas.length}: {atual}
        </p>
      ) : null}
      {resultados.length ? (
        <ul className="space-y-1" aria-label="Resultado da emissão">
          {resultados.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-perigo" />}
              <span>
                <span className="font-medium">{r.nome}</span>: {r.mensagem}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
