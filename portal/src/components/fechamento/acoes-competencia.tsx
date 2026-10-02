"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, LockOpen, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { BotaoAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { fecharCompetencia, iniciarFechamento, reabrirCompetencia } from "@/lib/fechamento/acoes";

export function BotaoIniciarFechamento({ empresaId, competencia, rotulo }: { empresaId: string; competencia: string; rotulo: string }) {
  return (
    <BotaoAcao
      acao={() => iniciarFechamento(empresaId, competencia)}
      confirmar={{
        titulo: `Iniciar o fechamento de ${rotulo}?`,
        descricao: "As cinco etapas (coleta, conferência, conciliação, revisão e publicação) são criadas e a coleta de documentos fica em andamento sob sua responsabilidade.",
        textoConfirmar: "Iniciar fechamento",
      }}
    >
      <Play /> Iniciar fechamento
    </BotaoAcao>
  );
}

export function BotaoFecharCompetencia({
  empresaId,
  competencia,
  rotulo,
  bloqueios,
  avisos,
}: {
  empresaId: string;
  competencia: string;
  rotulo: string;
  /** Impedimentos que o banco recusa (etapas abertas, pendências impeditivas). */
  bloqueios: string[];
  /** Pontos de atenção que não impedem o fechamento. */
  avisos: string[];
}) {
  const router = useRouter();
  const [observacao, setObservacao] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button variante="sucesso" disabled={bloqueios.length > 0} title={bloqueios.length ? "Resolva os impedimentos listados antes de fechar." : undefined}>
          <Lock /> Fechar competência
        </Button>
      }
      titulo={`Fechar a competência ${rotulo}?`}
      descricao="Depois de fechada, documentos e lançamentos deste mês só podem ser alterados com a reabertura justificada da competência."
      textoConfirmar="Fechar competência"
      aoConfirmar={async () => {
        const r = await fecharCompetencia(empresaId, competencia, observacao);
        if (r.ok) {
          toast.success(r.mensagem ?? "Competência fechada.");
          setObservacao("");
          router.refresh();
          return true;
        }
        toast.error(r.mensagem ?? "Não foi possível fechar a competência.");
        return false;
      }}
    >
      <div className="space-y-3">
        {avisos.length ? (
          <Alerta tom="alerta" titulo="Pontos de atenção">
            <ul className="list-disc pl-4">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Alerta>
        ) : null}
        <Textarea aria-label="Observação do fechamento (opcional)" placeholder="Observação do fechamento (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={2000} />
      </div>
    </Confirmacao>
  );
}

export function BotaoReabrirCompetencia({ empresaId, competencia, rotulo }: { empresaId: string; competencia: string; rotulo: string }) {
  const router = useRouter();
  const [justificativa, setJustificativa] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno">
          <LockOpen /> Reabrir competência
        </Button>
      }
      titulo={`Reabrir a competência ${rotulo}?`}
      descricao="A reabertura fica registrada no histórico e a equipe é avisada. As etapas de revisão e publicação voltam para andamento."
      textoConfirmar="Reabrir"
      variante="perigo"
      aoConfirmar={async () => {
        if (justificativa.trim().length < 10) {
          toast.error("Informe uma justificativa detalhada (mínimo de 10 caracteres).");
          return false;
        }
        const r = await reabrirCompetencia(empresaId, competencia, justificativa);
        if (r.ok) {
          toast.success(r.mensagem ?? "Competência reaberta.");
          setJustificativa("");
          router.refresh();
          return true;
        }
        toast.error(r.mensagem ?? "Não foi possível reabrir a competência.");
        return false;
      }}
    >
      <Textarea
        aria-label="Justificativa da reabertura"
        placeholder="Justificativa da reabertura (obrigatória, mínimo de 10 caracteres)"
        value={justificativa}
        onChange={(e) => setJustificativa(e.target.value)}
        rows={3}
        maxLength={2000}
      />
    </Confirmacao>
  );
}
