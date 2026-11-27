"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Handshake, Loader2, Repeat, ShieldCheck, ShieldX, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ResultadoAcao } from "@/lib/acoes";
import { alterarOcorrencia, decidirAprovacao, desfazerRenegociacao } from "@/lib/financeiro/acoes-titulos";

function useConcluir() {
  const router = useRouter();
  return (r: ResultadoAcao) => {
    if (r.ok) {
      toast.success(r.mensagem ?? "Feito.");
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível concluir.");
    return false;
  };
}

/** Aprovar ou reprovar um pagamento que pede aprovação. */
export function BotoesAprovacao({ empresaId, lancamentoId }: { empresaId: string; lancamentoId: string }) {
  const concluir = useConcluir();
  const [pendente, iniciar] = React.useTransition();
  const [motivo, setMotivo] = React.useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Button variante="sucesso" disabled={pendente} onClick={() => iniciar(async () => void concluir(await decidirAprovacao(empresaId, [lancamentoId], "aprovado")))}>
        {pendente ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Aprovar pagamento
      </Button>
      <Confirmacao
        gatilho={
          <Button variante="contorno" disabled={pendente}>
            <ShieldX /> Reprovar
          </Button>
        }
        titulo="Reprovar este pagamento?"
        descricao="Ele não poderá ser baixado enquanto estiver reprovado. Se o valor mudar, volta a pedir aprovação."
        textoConfirmar="Reprovar"
        variante="perigo"
        aoConfirmar={async () => {
          if (motivo.trim().length < 3) {
            toast.error("Explique por que o pagamento foi reprovado.");
            return false;
          }
          return concluir(await decidirAprovacao(empresaId, [lancamentoId], "reprovado", motivo)) ? undefined : false;
        }}
      >
        <Textarea aria-label="Motivo da reprovação" placeholder="Ex.: valor diferente do combinado" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
      </Confirmacao>
    </div>
  );
}

/** Desfaz um acordo de renegociação (sem pagamentos nas parcelas do acordo). */
export function BotaoDesfazerRenegociacao({ empresaId, renegociacaoId, numero }: { empresaId: string; renegociacaoId: string; numero: number }) {
  const concluir = useConcluir();
  const [motivo, setMotivo] = React.useState("");
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno" tamanho="sm">
          <Undo2 /> Desfazer renegociação
        </Button>
      }
      titulo={`Desfazer a renegociação nº ${numero}?`}
      descricao="As parcelas do acordo são retiradas e os títulos originais voltam a ficar em aberto. Só dá para desfazer se nenhuma parcela do acordo tiver sido paga."
      textoConfirmar="Desfazer"
      variante="perigo"
      aoConfirmar={async () => {
        if (motivo.trim().length < 5) {
          toast.error("Explique o motivo (ao menos 5 letras).");
          return false;
        }
        return concluir(await desfazerRenegociacao(empresaId, renegociacaoId, motivo)) ? undefined : false;
      }}
    >
      <Textarea aria-label="Motivo para desfazer" placeholder="Ex.: cliente desistiu do acordo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
    </Confirmacao>
  );
}

/** Ocorrência de uma recorrência: alterar só esta, esta e as próximas, ou encerrar a partir desta. */
export function AlterarRecorrencia({
  empresaId,
  lancamentoId,
  descricao,
  valor,
  vencimento,
  frequencia,
}: {
  empresaId: string;
  lancamentoId: string;
  descricao: string;
  valor: string;
  vencimento: string;
  frequencia: string;
}) {
  const concluir = useConcluir();
  const [aberto, setAberto] = React.useState(false);
  const [escopo, setEscopo] = React.useState<"esta" | "proximas" | "encerrar">("esta");
  const [d, setD] = React.useState({ descricao, valor, vencimento });
  const [pendente, iniciar] = React.useTransition();

  function salvar() {
    iniciar(async () => {
      const mudou = {
        descricao: d.descricao !== descricao ? d.descricao : undefined,
        valor: d.valor !== valor ? d.valor : undefined,
        data_vencimento: d.vencimento !== vencimento ? d.vencimento : undefined,
      };
      if (concluir(await alterarOcorrencia(empresaId, lancamentoId, escopo, mudou))) setAberto(false);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <Repeat /> Alterar recorrência
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Alterar a recorrência" descricao={`Lançamento ${frequencia}. Escolha se a mudança vale só para esta ocorrência ou também para as próximas.`}>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">O que mudar</legend>
            {(
              [
                ["esta", "Só esta ocorrência", "As outras continuam como estão."],
                ["proximas", "Esta e as próximas", "Vale para esta, para as próximas ainda não pagas e para as que vierem."],
                ["encerrar", "Encerrar a partir desta", "Esta e as próximas não pagas são canceladas; a recorrência termina."],
              ] as const
            ).map(([v, r, a]) => (
              <label key={v} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="escopo" value={v} checked={escopo === v} onChange={() => setEscopo(v)} className="mt-1 accent-[var(--primary)]" />
                <span>
                  <span className="block font-medium">{r}</span>
                  <span className="text-xs text-muted-foreground">{a}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {escopo !== "encerrar" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Descrição" htmlFor="rec-desc" className="sm:col-span-2">
                <Input id="rec-desc" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} />
              </Campo>
              <Campo rotulo="Valor" htmlFor="rec-valor">
                <CampoValor id="rec-valor" valorInicial={valor} aoMudar={(v) => setD({ ...d, valor: v })} />
              </Campo>
              <Campo rotulo={escopo === "esta" ? "Vencimento" : "Dia do vencimento (pela data)"} htmlFor="rec-venc">
                <Input id="rec-venc" type="date" value={d.vencimento} onChange={(e) => setD({ ...d, vencimento: e.target.value })} />
              </Campo>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variante="fantasma" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button onClick={salvar} disabled={pendente} variante={escopo === "encerrar" ? "perigo" : "primario"}>
              {pendente ? <Loader2 className="animate-spin" /> : escopo === "encerrar" ? <Handshake /> : <Check />} {escopo === "encerrar" ? "Encerrar recorrência" : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
