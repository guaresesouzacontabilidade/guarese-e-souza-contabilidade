"use client";

import { useState } from "react";
import { CalendarCheck, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { Alerta } from "@/components/ui/feedback";
import { concluirEtapaConciliacao, informarSaldoExtrato } from "@/lib/conciliacao/acoes";
import { formatarCompetencia } from "@/lib/formatos";
import { useExecutar } from "./sugestoes";
import type { Opcao } from "./tipos";

export function InformarSaldo({ empresaId, contas, dataPadrao }: { empresaId: string; contas: Opcao[]; dataPadrao: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button tamanho="sm" variante="contorno">
          <Plus /> Informar saldo do extrato
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Informar saldo do extrato" descricao="Para extratos sem saldo no arquivo (ex.: PDF). Informe o saldo ao final do dia, como aparece no banco.">
        <FormularioAcao acao={informarSaldoExtrato.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Conta" htmlFor="s-conta" obrigatorio erro={estado.erros?.conta_financeira_id}>
                <Select id="s-conta" name="conta_financeira_id" defaultValue={contas.length === 1 ? contas[0].id : ""}>
                  <option value="">Selecione...</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Data" htmlFor="s-data" obrigatorio erro={estado.erros?.data}>
                <Input id="s-data" name="data" type="date" defaultValue={dataPadrao} />
              </Campo>
              <Campo rotulo="Saldo ao final do dia" htmlFor="s-saldo" obrigatorio erro={estado.erros?.saldo} ajuda="Use o sinal de menos para saldo negativo.">
                <CampoValor id="s-saldo" name="saldo" permitirNegativo />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar saldo</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function ConcluirEtapa({
  empresaId,
  competencia,
  impedimentos,
  avisos,
  concluida,
}: {
  empresaId: string;
  competencia: string;
  impedimentos: string[];
  avisos: string[];
  concluida: boolean;
}) {
  const { executar, pendente } = useExecutar();
  const [justificativa, setJustificativa] = useState("");
  const rotulo = formatarCompetencia(competencia);
  if (concluida) {
    return (
      <Alerta tom="sucesso" titulo={`Conciliação de ${rotulo} concluída`}>
        A etapa de conciliação do fechamento desta competência está concluída.
      </Alerta>
    );
  }
  return (
    <div className="space-y-3">
      {impedimentos.length ? (
        <Alerta tom="alerta" titulo="Ainda não é possível concluir">
          <ul className="list-disc pl-4">
            {impedimentos.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      {avisos.length ? (
        <Alerta tom="info" titulo="Conferência de saldos">
          <ul className="list-disc pl-4">
            {avisos.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      {!impedimentos.length && avisos.length ? (
        <Campo rotulo="Justificativa das diferenças" htmlFor="f-just" obrigatorio>
          <Textarea id="f-just" rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: tarifa do banco lançada no mês seguinte" />
        </Campo>
      ) : null}
      <div className="flex justify-end">
        <Button
          variante="sucesso"
          disabled={pendente || impedimentos.length > 0 || (avisos.length > 0 && justificativa.trim().length < 5)}
          onClick={() => executar(() => concluirEtapaConciliacao(empresaId, competencia, justificativa))}
        >
          {pendente ? <Loader2 className="animate-spin" /> : <CalendarCheck />} Concluir conciliação de {rotulo}
        </Button>
      </div>
    </div>
  );
}
