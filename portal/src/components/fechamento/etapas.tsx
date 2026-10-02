"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Pencil, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarDataHora } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, STATUS_ETAPA } from "@/lib/rotulos";
import { alterarStatusEtapa, atualizarEtapa } from "@/lib/fechamento/acoes";

export interface EtapaFechamento {
  id: string;
  etapa: string;
  ordem: number;
  status: string;
  responsavel_id: string | null;
  responsavel: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  concluida_por: string | null;
  observacao: string | null;
  /** Pendências impeditivas abertas vinculadas à etapa. */
  impeditivas: number;
}

interface Opcao {
  id: string;
  nome: string;
}

export function EtapasFechamento({
  empresaId,
  etapas,
  fechada,
  equipe,
}: {
  empresaId: string;
  etapas: EtapaFechamento[];
  fechada: boolean;
  equipe: Opcao[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<EtapaFechamento | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const mudar = async (etapa: EtapaFechamento, status: string) => {
    setOcupado(etapa.id);
    try {
      const r = await alterarStatusEtapa(empresaId, etapa.id, status);
      if (r.ok) {
        toast.success(r.mensagem ?? "Etapa atualizada.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível atualizar a etapa.");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      <ol className="divide-y divide-border rounded-lg border border-border">
        {etapas.map((e) => {
          const st = STATUS_ETAPA[e.status] ?? { rotulo: e.status, tom: "neutro" as const };
          // Com a competência fechada, só a publicação pode ser alterada (regra do banco).
          const bloqueada = fechada && e.etapa !== "publicacao";
          const pendente = ocupado === e.id;
          return (
            <li key={e.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
              <div className="flex min-w-0 gap-3">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold numero",
                    e.status === "concluida" ? "border-sucesso bg-sucesso-bg text-sucesso-fg" : e.status === "em_andamento" ? "border-alerta bg-alerta-bg text-alerta-fg" : "border-border text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {e.status === "concluida" ? <CheckCircle2 className="size-4" /> : e.ordem}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-titulo">
                    {ETAPAS_FECHAMENTO[e.etapa] ?? e.etapa}
                    <Badge variante={st.tom}>{st.rotulo}</Badge>
                    {e.impeditivas ? <Badge variante="perigo">{e.impeditivas} pendência(s) impeditiva(s)</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Responsável: {e.responsavel ?? "não definido"}
                    {e.iniciada_em ? ` · iniciada em ${formatarDataHora(e.iniciada_em)}` : ""}
                    {e.concluida_em ? ` · concluída em ${formatarDataHora(e.concluida_em)}${e.concluida_por ? ` por ${e.concluida_por}` : ""}` : ""}
                  </p>
                  {e.observacao ? <p className="whitespace-pre-line text-sm text-muted-foreground">{e.observacao}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                {e.status === "nao_iniciada" ? (
                  <Button tamanho="sm" variante="contorno" disabled={bloqueada || pendente} onClick={() => mudar(e, "em_andamento")}>
                    <Play /> Iniciar
                  </Button>
                ) : null}
                {e.status !== "concluida" ? (
                  <Button
                    tamanho="sm"
                    variante="sucesso"
                    disabled={bloqueada || pendente || e.impeditivas > 0}
                    title={e.impeditivas ? "Resolva ou dispense as pendências impeditivas desta etapa antes de concluí-la." : undefined}
                    onClick={() => mudar(e, "concluida")}
                  >
                    <CheckCircle2 /> Concluir
                  </Button>
                ) : (
                  <Button tamanho="sm" variante="contorno" disabled={bloqueada || pendente} onClick={() => mudar(e, "em_andamento")}>
                    <RotateCcw /> Reabrir etapa
                  </Button>
                )}
                <Button tamanho="sm" variante="fantasma" disabled={bloqueada} onClick={() => setEditando(e)} aria-label={`Editar ${ETAPAS_FECHAMENTO[e.etapa] ?? e.etapa}`}>
                  <Pencil /> Editar
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando ? (
          <DialogContent titulo={`Etapa: ${ETAPAS_FECHAMENTO[editando.etapa] ?? editando.etapa}`} descricao="Defina a situação, o responsável e registre observações do trabalho feito.">
            <FormularioAcao acao={atualizarEtapa.bind(null, empresaId, editando.id)} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  <Campo rotulo="Situação" htmlFor="etapa-status" erro={estado.erros?.status} obrigatorio>
                    <Select id="etapa-status" name="status" defaultValue={editando.status}>
                      {Object.entries(STATUS_ETAPA).map(([v, s]) => (
                        <option key={v} value={v}>
                          {s.rotulo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Responsável" htmlFor="etapa-responsavel" erro={estado.erros?.responsavel_id} ajuda="Deixe como está para manter o responsável atual.">
                    <Select id="etapa-responsavel" name="responsavel_id" defaultValue={editando.responsavel_id ?? ""}>
                      <option value="">{editando.responsavel_id ? "Manter o responsável atual" : "Sem responsável"}</option>
                      {equipe.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Observação" htmlFor="etapa-observacao" erro={estado.erros?.observacao} ajuda="Fica registrada no histórico da competência.">
                    <Textarea id="etapa-observacao" name="observacao" defaultValue={editando.observacao ?? ""} rows={3} maxLength={2000} />
                  </Campo>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variante="contorno" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                    <BotaoEnviar pendente={pendente}>Salvar etapa</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
