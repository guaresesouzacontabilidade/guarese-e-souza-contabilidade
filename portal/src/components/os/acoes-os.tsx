"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCheck, Copy, MessageCircle, Pause, Pencil, Play, Printer, RotateCcw, Smartphone, Tag, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { atribuirOs, cancelarOs, moverOs, pausarOs, retomarOs } from "@/lib/os/acoes";
import { ETAPA } from "@/lib/os/rotulos";
import { DialogoEntregar } from "./entregar-os";
import { FormOs, type OsInicial, type PessoaOs, type ServicoOs } from "./form-os";
import { DialogoReceber } from "./receber-os";

/** Ações da página da OS: editar, mover, pausar, avisar, imprimir e cancelar. */
export function AcoesOs({
  empresaId,
  os,
  etapa,
  pausada,
  responsavelId,
  servicos,
  equipe,
  whatsapp,
  linkAcompanhar,
  podeGerenciar,
  podeReceber = false,
  falta = 0,
  whatsappAtivo = false,
}: {
  empresaId: string;
  os: OsInicial & { numero: number };
  etapa: string;
  pausada: boolean;
  responsavelId: string | null;
  servicos: ServicoOs[];
  equipe: PessoaOs[];
  whatsapp: string | null;
  linkAcompanhar: string;
  podeGerenciar: boolean;
  /** Opera o caixa da Loja (recebe pela OS) */
  podeReceber?: boolean;
  /** Quanto falta receber */
  falta?: number;
  whatsappAtivo?: boolean;
}) {
  const router = useRouter();
  const [editar, setEditar] = React.useState(false);
  const [pausar, setPausar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [entregar, setEntregar] = React.useState(false);
  const [receber, setReceber] = React.useState(false);
  const [pendente, iniciar] = React.useTransition();
  const fechada = etapa === "entregue" || etapa === "cancelada";

  const rodar = (fn: () => Promise<{ ok: boolean; mensagem?: string }>, sucessoPadrao?: string) =>
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.mensagem || sucessoPadrao) toast.success(r.mensagem || sucessoPadrao!);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível concluir.");
    });

  const mover = (para: string, rotulo: string) => rodar(() => moverOs(empresaId, os.id, para, null), `OS movida para “${rotulo}”.`);

  return (
    <div className="flex flex-wrap gap-2">
      {etapa === "fila" ? (
        <Button onClick={() => mover("execucao", ETAPA.execucao.rotulo)} disabled={pendente}>
          <Play /> Iniciar
        </Button>
      ) : null}
      {etapa === "execucao" ? (
        <>
          <Button onClick={() => mover("pronta", ETAPA.pronta.rotulo)} disabled={pendente}>
            <CheckCheck /> Marcar pronta
          </Button>
          {pausada ? (
            <Button variante="contorno" onClick={() => rodar(() => retomarOs(empresaId, os.id))} disabled={pendente}>
              <Play /> Retomar
            </Button>
          ) : (
            <Button variante="contorno" onClick={() => setPausar(true)} disabled={pendente}>
              <Pause /> Pausar
            </Button>
          )}
        </>
      ) : null}
      {etapa === "pronta" ? (
        <Button onClick={() => setEntregar(true)} disabled={pendente}>
          <CheckCheck /> Entregar
        </Button>
      ) : null}
      {etapa === "execucao" || etapa === "pronta" ? (
        <Button variante="contorno" onClick={() => mover(etapa === "pronta" ? "execucao" : "fila", etapa === "pronta" ? ETAPA.execucao.rotulo : ETAPA.fila.rotulo)} disabled={pendente}>
          <RotateCcw /> Voltar etapa
        </Button>
      ) : null}
      {etapa === "entregue" && podeGerenciar ? (
        <Button variante="contorno" onClick={() => mover("pronta", ETAPA.pronta.rotulo)} disabled={pendente}>
          <RotateCcw /> Reabrir
        </Button>
      ) : null}
      {podeReceber && falta > 0 && etapa !== "cancelada" ? (
        <Button variante={etapa === "pronta" ? "contorno" : "secundario"} onClick={() => setReceber(true)} disabled={pendente}>
          <Wallet /> Receber
        </Button>
      ) : null}
      {whatsapp ? (
        <Button variante="contorno" asChild>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Avisar no WhatsApp
          </a>
        </Button>
      ) : null}
      <Button variante="contorno" asChild>
        <a href={`/impressao/os/${os.id}`} target="_blank" rel="noopener noreferrer">
          <Printer /> Imprimir
        </a>
      </Button>
      <Button variante="contorno" asChild>
        <a href={`/impressao/os/${os.id}?etiqueta=1`} target="_blank" rel="noopener noreferrer" title="Etiqueta para colar no material, com o QR Code da bancada">
          <Tag /> Etiqueta
        </a>
      </Button>
      {!fechada ? (
        <Button variante="contorno" asChild>
          <a href={`/e/${empresaId}/os/${os.id}/bancada`} title="Tela da bancada (celular): botões grandes para iniciar, pausar, fotografar e marcar pronta">
            <Smartphone /> Bancada
          </a>
        </Button>
      ) : null}
      <Button
        variante="contorno"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(linkAcompanhar);
            toast.success("Link de acompanhamento copiado.");
          } catch {
            toast.error("Não foi possível copiar. O link está na via do cliente (QR Code).");
          }
        }}
      >
        <Copy /> Link do cliente
      </Button>
      {!fechada ? (
        <>
          <Select
            aria-label="Responsável"
            className="w-auto"
            value={responsavelId ?? ""}
            onChange={(e) => rodar(() => atribuirOs(empresaId, os.id, e.target.value || null))}
            disabled={pendente}
          >
            <option value="">Sem responsável</option>
            {equipe
              .filter((p) => p.ativo || p.id === responsavelId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </Select>
          <Dialog open={editar} onOpenChange={setEditar}>
            <DialogTrigger asChild>
              <Button variante="contorno">
                <Pencil /> Editar
              </Button>
            </DialogTrigger>
            <DialogContent titulo={`Editar a OS nº ${os.numero}`} largura="xl">
              <FormOs empresaId={empresaId} servicos={servicos} equipe={equipe} inicial={os} aoSalvar={() => setEditar(false)} whatsappAtivo={whatsappAtivo} />
            </DialogContent>
          </Dialog>
        </>
      ) : null}
      {!fechada && podeGerenciar ? (
        <Confirmacao
          gatilho={
            <Button variante="fantasma">
              <Ban /> Cancelar OS
            </Button>
          }
          titulo={`Cancelar a OS nº ${os.numero}?`}
          descricao="A OS sai da esteira e fica no histórico como cancelada."
          textoConfirmar="Cancelar OS"
          variante="perigo"
          aoConfirmar={async () => {
            if (!motivo.trim()) {
              toast.error("Informe o motivo do cancelamento.");
              return false;
            }
            const r = await cancelarOs(empresaId, os.id, motivo);
            if (r.ok) {
              toast.success(r.mensagem ?? "OS cancelada.");
              router.refresh();
            } else {
              toast.error(r.mensagem ?? "Não foi possível cancelar.");
              return false;
            }
          }}
        >
          <Campo rotulo="Motivo" htmlFor="os-motivo-cancelar" obrigatorio>
            <Textarea id="os-motivo-cancelar" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
          </Campo>
        </Confirmacao>
      ) : null}

      <Dialog open={pausar} onOpenChange={setPausar}>
        <DialogContent titulo={`Pausar a OS nº ${os.numero}`} descricao="O tempo parado não conta como execução." largura="sm">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPausar(false);
              rodar(() => pausarOs(empresaId, os.id, motivo));
            }}
          >
            <Campo rotulo="Motivo" htmlFor="os-motivo-pausa-detalhe" obrigatorio>
              <Input id="os-motivo-pausa-detalhe" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ex.: Falta de material" />
            </Campo>
            <div className="flex justify-end">
              <Button type="submit" disabled={!motivo.trim()}>
                <Pause /> Pausar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {entregar ? (
        <DialogoEntregar
          empresaId={empresaId}
          osId={os.id}
          aoFechar={() => setEntregar(false)}
          aoEntregar={() => {
            setEntregar(false);
            router.refresh();
          }}
        />
      ) : null}
      {receber ? <DialogoReceber empresaId={empresaId} osId={os.id} aoFechar={() => setReceber(false)} /> : null}
    </div>
  );
}
