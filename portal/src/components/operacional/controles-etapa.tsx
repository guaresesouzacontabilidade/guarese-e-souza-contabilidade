"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, Check, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { Checkbox, Label, Textarea } from "@/components/ui/form";
import { cobrarCliente, desmarcarEtapa, marcarEtapa } from "@/lib/operacional/acoes";
import type { AcaoEtapa, EtapaCalculada } from "@/lib/operacional/mapa";
import type { ResultadoAcao } from "@/lib/acoes";

function useExecutar() {
  const router = useRouter();
  return async (acao: () => Promise<ResultadoAcao>): Promise<boolean> => {
    const r = await acao();
    if (r.ok) {
      if (r.mensagem) toast.success(r.mensagem);
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível concluir.");
    return false;
  };
}

/** O botão do que fazer agora (abre a tela certa ou cobra o cliente). */
export function BotaoAcaoEtapa({
  acao,
  empresaId,
  competencia,
  principal = true,
  tamanho = "md",
}: {
  acao: AcaoEtapa;
  empresaId: string;
  competencia: string;
  principal?: boolean;
  tamanho?: "sm" | "md";
}) {
  const executar = useExecutar();
  if (acao.tipo === "cobrar") {
    return (
      <Confirmacao
        gatilho={
          <Button variante={principal ? "primario" : "contorno"} tamanho={tamanho}>
            <Send /> {acao.rotulo}
          </Button>
        }
        titulo="Mandar o lembrete ao cliente?"
        descricao="O cliente recebe, no portal e pelos canais ligados (e-mail e WhatsApp), a lista do que ainda falta mandar neste mês."
        textoConfirmar="Mandar o lembrete"
        aoConfirmar={() => executar(() => cobrarCliente(empresaId, competencia))}
      />
    );
  }
  if (!acao.href) return null;
  return (
    <Button asChild variante={principal ? "primario" : "contorno"} tamanho={tamanho}>
      <Link href={acao.href}>
        {acao.rotulo}
        {principal ? <ArrowRight /> : null}
      </Link>
    </Button>
  );
}

/** Marcar a etapa como concluída / "não se aplica", ou desfazer a marcação. */
export function MarcacaoEtapa({
  etapa,
  empresaId,
  competencia,
  tamanho = "md",
}: {
  etapa: EtapaCalculada;
  empresaId: string;
  competencia: string;
  tamanho?: "sm" | "md";
}) {
  const executar = useExecutar();
  const [observacao, setObservacao] = React.useState("");
  const [todas, setTodas] = React.useState(false);
  const idObs = React.useId();
  const idTodas = React.useId();

  if (etapa.marcacao) {
    const m = etapa.marcacao;
    return (
      <Confirmacao
        gatilho={
          <Button variante="contorno" tamanho={tamanho}>
            <Undo2 /> Desfazer a marcação
          </Button>
        }
        titulo="Desfazer a marcação?"
        descricao={`A etapa "${etapa.nome}" volta a mostrar o que os dados do portal dizem${m.todas ? " (vale para todos os meses)" : ""}.`}
        textoConfirmar="Desfazer"
        aoConfirmar={() => executar(() => desmarcarEtapa(empresaId, etapa.chave, competencia, m.todas))}
      />
    );
  }

  const campoObs = (
    <div className="space-y-1.5">
      <Label htmlFor={idObs}>Observação (opcional)</Label>
      <Textarea id={idObs} rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: conferido no sistema antigo" />
    </div>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {etapa.status !== "ok" ? (
        <Confirmacao
          gatilho={
            <Button variante="contorno" tamanho={tamanho}>
              <Check /> Marcar como concluída
            </Button>
          }
          titulo={`Marcar "${etapa.nome}" como concluída?`}
          descricao="Use quando a etapa foi resolvida fora do portal. O mapa passa a mostrar a etapa como concluída neste mês."
          textoConfirmar="Marcar como concluída"
          aoConfirmar={() => executar(() => marcarEtapa(empresaId, etapa.chave, competencia, "concluida", { observacao }))}
        >
          {campoObs}
        </Confirmacao>
      ) : null}
      {etapa.status !== "na" ? (
        <Confirmacao
          gatilho={
            <Button variante="fantasma" tamanho={tamanho}>
              <Ban /> Não se aplica
            </Button>
          }
          titulo={`"${etapa.nome}" não se aplica a esta empresa?`}
          descricao="Ex.: empresa sem conta bancária, MEI sem obrigações no mês. A etapa fica tracejada e sai das contas do mapa."
          textoConfirmar='Marcar "não se aplica"'
          aoConfirmar={() => executar(() => marcarEtapa(empresaId, etapa.chave, competencia, "nao_se_aplica", { observacao, todas }))}
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox id={idTodas} checked={todas} onChange={(e) => setTodas(e.target.checked)} />
              <Label htmlFor={idTodas} className="font-normal">
                Vale para todos os meses desta empresa
              </Label>
            </div>
            {campoObs}
          </div>
        </Confirmacao>
      ) : null}
    </div>
  );
}
