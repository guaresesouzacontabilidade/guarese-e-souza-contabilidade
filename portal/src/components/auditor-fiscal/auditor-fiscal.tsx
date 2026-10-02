"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, HandCoins, RotateCcw, ScanSearch, Send, X } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Textarea } from "@/components/ui/form";
import { analisarAgora, pedirAjudaAchado, revisarAchado } from "@/lib/auditor-fiscal/acoes";

export function BotaoAnalisar({ empresaId, emAndamento }: { empresaId: string; emAndamento: boolean }) {
  return (
    <BotaoAcao acao={analisarAgora.bind(null, empresaId)} disabled={emAndamento}>
      <ScanSearch /> {emAndamento ? "Analisando..." : "Analisar agora"}
    </BotaoAcao>
  );
}

/** Atualiza a tela a cada poucos segundos enquanto uma análise está na fila (até 3 minutos). */
export function AtualizarEnquanto({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!ativo) return;
    const inicio = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - inicio > 180_000) return window.clearInterval(id);
      router.refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [ativo, router]);
  return null;
}

function DialogoRevisao({
  empresaId,
  achadoId,
  acao,
  gatilho,
  titulo,
  descricao,
  campo,
  textoInicial,
  textoBotao,
  perigo,
}: {
  empresaId: string;
  achadoId: string;
  acao: "descartar" | "publicar" | "resolver";
  gatilho: React.ReactNode;
  titulo: string;
  descricao: string;
  campo: { nome: "motivo" | "texto_cliente"; rotulo: string; ajuda?: string; obrigatorio?: boolean };
  textoInicial?: string;
  textoBotao: string;
  perigo?: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const id = `${acao}-${achadoId}`;
  return (
    <>
      <span onClick={() => setAberto(true)}>{gatilho}</span>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={titulo} descricao={descricao} largura="lg">
          <FormularioAcao acao={revisarAchado.bind(null, empresaId, achadoId, acao)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo={campo.rotulo} htmlFor={id} erro={estado.erros?.[campo.nome]} ajuda={campo.ajuda} obrigatorio={campo.obrigatorio}>
                  <Textarea id={id} name={campo.nome} rows={campo.nome === "texto_cliente" ? 6 : 3} maxLength={campo.nome === "texto_cliente" ? 3000 : 1000} defaultValue={textoInicial} />
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

function FormSimples({ empresaId, achadoId, acao, children }: { empresaId: string; achadoId: string; acao: "confirmar" | "reabrir" | "retirar"; children: React.ReactNode }) {
  return (
    <FormularioAcao acao={revisarAchado.bind(null, empresaId, achadoId, acao)}>
      {({ pendente }) => (
        <BotaoEnviar pendente={pendente} variante="contorno" tamanho="sm" textoPendente="Salvando...">
          {children}
        </BotaoEnviar>
      )}
    </FormularioAcao>
  );
}

/** Ações da equipe sobre um achado, conforme a situação. */
export function AcoesAchado({
  empresaId,
  achado,
  mensagemPadrao,
}: {
  empresaId: string;
  achado: { id: string; situacao: string; publicado: boolean; pedidoCliente: boolean };
  mensagemPadrao: string;
}) {
  const { id, situacao } = achado;
  return (
    <div className="flex flex-wrap gap-2">
      {situacao === "novo" ? (
        <FormSimples empresaId={empresaId} achadoId={id} acao="confirmar">
          <Check /> Confirmar
        </FormSimples>
      ) : null}
      {situacao === "novo" || situacao === "confirmado" ? (
        <>
          <DialogoRevisao
            empresaId={empresaId}
            achadoId={id}
            acao="publicar"
            gatilho={
              <Button tamanho="sm">
                <Send /> Publicar ao cliente
              </Button>
            }
            titulo="Publicar ao cliente"
            descricao="O cliente recebe um aviso e vê a mensagem abaixo, o valor estimado e o mês. A memória de cálculo e as notas ficam só para a equipe."
            campo={{ nome: "texto_cliente", rotulo: "Mensagem para o cliente", ajuda: "Linguagem simples, sem termos técnicos.", obrigatorio: true }}
            textoInicial={mensagemPadrao}
            textoBotao="Publicar"
          />
          <DialogoRevisao
            empresaId={empresaId}
            achadoId={id}
            acao="descartar"
            gatilho={
              <Button tamanho="sm" variante="contorno">
                <X /> Descartar
              </Button>
            }
            titulo="Descartar o achado"
            descricao="Ele sai da lista em aberto e não volta nas próximas análises. Fica registrado quem descartou e o motivo."
            campo={{ nome: "motivo", rotulo: "Motivo", ajuda: "Ex.: a receita já foi separada no PGDAS-D.", obrigatorio: true }}
            textoBotao="Descartar"
            perigo
          />
        </>
      ) : null}
      {situacao === "confirmado" || situacao === "publicado" ? (
        <DialogoRevisao
          empresaId={empresaId}
          achadoId={id}
          acao="resolver"
          gatilho={
            <Button tamanho="sm" variante="contorno">
              <Check /> Concluir
            </Button>
          }
          titulo="Concluir o achado"
          descricao="Use quando o assunto foi resolvido (restituição pedida, apuração retificada ou cadastro corrigido)."
          campo={{ nome: "motivo", rotulo: "O que foi feito (opcional)", ajuda: "Ex.: PGDAS-D retificado e pedido de restituição feito em 10/10/2026." }}
          textoBotao="Concluir"
        />
      ) : null}
      {situacao === "publicado" && !achado.pedidoCliente ? (
        <FormSimples empresaId={empresaId} achadoId={id} acao="retirar">
          <EyeOff /> Retirar do cliente
        </FormSimples>
      ) : null}
      {situacao === "descartado" || situacao === "resolvido" ? (
        <FormSimples empresaId={empresaId} achadoId={id} acao="reabrir">
          <RotateCcw /> Reabrir
        </FormSimples>
      ) : null}
    </div>
  );
}

export function BotaoPedirAjuda({ empresaId, achadoId }: { empresaId: string; achadoId: string }) {
  return (
    <BotaoAcao
      acao={pedirAjudaAchado.bind(null, empresaId, achadoId)}
      confirmar={{
        titulo: "Pedir ao escritório que cuide disso?",
        descricao: "O escritório recebe o pedido em Solicitações, confere a apuração e informa o que pode ser recuperado. Você acompanha tudo por lá.",
        textoConfirmar: "Enviar pedido",
      }}
    >
      <HandCoins /> Quero que o escritório cuide disso
    </BotaoAcao>
  );
}
