"use client";

import * as React from "react";
import { Bot, Check, FileDown, Presentation, RotateCcw, X } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { revisarEstudo, rodarEstudos, salvarPremissas, type AcaoRevisao } from "@/lib/estudos/acoes";

/** "Rodar agora" de uma empresa ou de toda a carteira. */
export function BotaoRodarRobo({ empresaId, emAndamento, rotulo }: { empresaId?: string; emAndamento?: boolean; rotulo?: string }) {
  return (
    <BotaoAcao
      acao={() => rodarEstudos(empresaId)}
      disabled={emAndamento}
      confirmar={
        empresaId
          ? undefined
          : {
              titulo: "Rodar o robô em toda a carteira?",
              descricao: "O robô estuda todas as empresas que você atende, uma por vez, pela fila. Os resultados aparecem conforme ficam prontos.",
              textoConfirmar: "Rodar agora",
            }
      }
    >
      <Bot /> {emAndamento ? "Estudando..." : (rotulo ?? "Rodar agora")}
    </BotaoAcao>
  );
}

function FormSimples({ id, acao, children, variante = "contorno" }: { id: string; acao: AcaoRevisao; children: React.ReactNode; variante?: "contorno" | "primario" }) {
  return (
    <FormularioAcao acao={revisarEstudo.bind(null, id, acao)}>
      {({ pendente }) => (
        <BotaoEnviar pendente={pendente} variante={variante} tamanho="sm" textoPendente="Salvando...">
          {children}
        </BotaoEnviar>
      )}
    </FormularioAcao>
  );
}

function DialogoMotivo({
  id,
  acao,
  gatilho,
  titulo,
  descricao,
  rotulo,
  ajuda,
  obrigatorio,
  textoBotao,
  perigo,
}: {
  id: string;
  acao: AcaoRevisao;
  gatilho: React.ReactNode;
  titulo: string;
  descricao: string;
  rotulo: string;
  ajuda: string;
  obrigatorio?: boolean;
  textoBotao: string;
  perigo?: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const campo = `motivo-${acao}-${id}`;
  return (
    <>
      <span onClick={() => setAberto(true)}>{gatilho}</span>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={titulo} descricao={descricao} largura="lg">
          <FormularioAcao acao={revisarEstudo.bind(null, id, acao)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo={rotulo} htmlFor={campo} erro={estado.erros?.motivo} ajuda={ajuda} obrigatorio={obrigatorio}>
                  <Textarea id={campo} name="motivo" rows={3} maxLength={1000} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante={perigo ? "perigo" : "primario"} textoPendente="Salvando...">
                    {textoBotao}
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ações da equipe sobre um estudo, conforme a situação da revisão. */
export function AcoesEstudo({ id, situacao }: { id: string; situacao: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {situacao === "nova" ? (
        <>
          <DialogoMotivo
            id={id}
            acao="aprovar"
            gatilho={
              <Button tamanho="sm">
                <Check /> Aprovar
              </Button>
            }
            titulo="Aprovar o estudo"
            descricao="Depois de aprovado, você pode gerar o PDF para apresentar ao cliente. Fica registrado quem aprovou e o valor da época."
            rotulo="Observação (opcional)"
            ajuda="Ex.: conferido com o sócio; mudar a partir de janeiro."
            textoBotao="Aprovar"
          />
          <DialogoMotivo
            id={id}
            acao="descartar"
            gatilho={
              <Button tamanho="sm" variante="contorno">
                <X /> Descartar
              </Button>
            }
            titulo="Descartar o estudo"
            descricao="Ele sai da lista em aberto. Se o robô voltar a encontrar a mesma oportunidade, ela continua descartada; só volta se deixar de existir e aparecer de novo."
            rotulo="Motivo"
            ajuda="Ex.: o cliente vai mudar de atividade no ano que vem."
            obrigatorio
            textoBotao="Descartar"
            perigo
          />
        </>
      ) : null}
      {situacao === "aprovada" || situacao === "apresentada" ? (
        <Button asChild tamanho="sm" variante={situacao === "aprovada" ? "primario" : "contorno"}>
          <a href={`/api/escritorio/oportunidades/${id}/pdf`}>
            <FileDown /> PDF para o cliente
          </a>
        </Button>
      ) : null}
      {situacao === "aprovada" ? (
        <FormSimples id={id} acao="apresentar">
          <Presentation /> Marcar como apresentado
        </FormSimples>
      ) : null}
      {situacao !== "nova" ? (
        <FormSimples id={id} acao="reabrir">
          <RotateCcw /> Reabrir
        </FormSimples>
      ) : null}
    </div>
  );
}

/** Premissas do comparativo de regimes que o robô usa (margem de lucro e ICMS médio). */
export function FormPremissas({ empresaId, margem, icms, mostrarIcms }: { empresaId: string; margem: string; icms: string; mostrarIcms: boolean }) {
  return (
    <FormularioAcao acao={salvarPremissas.bind(null, empresaId)} className="grid items-start gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      {({ estado, pendente }) => (
        <>
          <Campo
            rotulo="Margem de lucro (%)"
            htmlFor="premissa-margem"
            erro={estado.erros?.margem_lucro}
            ajuda="Lucro antes do IRPJ e da CSLL, em % da receita. Sem ela, o Lucro Real fica de fora da comparação."
          >
            <Input id="premissa-margem" name="margem_lucro" inputMode="decimal" defaultValue={margem} placeholder="Ex.: 12,5" />
          </Campo>
          {mostrarIcms ? (
            <Campo
              rotulo="ICMS médio nas vendas (%)"
              htmlFor="premissa-icms"
              erro={estado.erros?.aliquota_icms_media}
              ajuda="Fora do Simples. Em branco, usa a média destacada nas notas."
            >
              <Input id="premissa-icms" name="aliquota_icms_media" inputMode="decimal" defaultValue={icms} placeholder="Ex.: 12" />
            </Campo>
          ) : (
            <input type="hidden" name="aliquota_icms_media" value={icms} />
          )}
          <div className="flex items-end sm:pt-6">
            <BotaoEnviar pendente={pendente} textoPendente="Guardando...">
              Guardar e estudar de novo
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
