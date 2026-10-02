"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, Download, FileArchive, Loader2, Lock, Search, ShieldAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarCompetencia, formatarData, formatarDataHora, formatarTamanho } from "@/lib/formatos";
import { STATUS_DOCUMENTO } from "@/lib/rotulos";
import { alterarStatusDocumentos, alterarStatusEmLote } from "@/lib/documentos/acoes";
import type { ResultadoAcao } from "@/lib/acoes";

export interface LinhaDocumento {
  id: string;
  empresa_id: string;
  empresa_nome?: string;
  nome: string;
  titulo: string | null;
  categoria: string;
  competencia: string;
  status: string | null;
  direcao: string;
  enviado_em: string | null;
  enviado_por: string | null;
  tamanho: number | null;
  recebido_apos_fechamento: boolean;
  requer_conferencia: boolean;
  verificacao_status: string;
  processamento_status: string;
  zip_origem_id: string | null;
  eh_zip: boolean;
  vencimento: string | null;
  valor: number | null;
  versao_atual: number;
  sugestao: boolean;
}

interface Props {
  linhas: LinhaDocumento[];
  podeBaixar: boolean;
  podeRevisar: boolean;
  /** Fila do escritório (várias empresas): mostra a empresa e usa a ação em lote global. */
  multiempresa?: boolean;
  empresaId?: string;
  /** Rota base da lista (ex.: /e/ID/documentos); na fila do escritório o link usa a empresa de cada linha. */
  base?: string;
}

export function TabelaDocumentos({ linhas, podeBaixar, podeRevisar, multiempresa = false, empresaId, base }: Props) {
  const hrefDocumento = (l: LinhaDocumento) => (multiempresa || !base ? `/e/${l.empresa_id}/documentos/${l.id}` : `${base}/${l.id}`);
  const router = useRouter();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const formLote = useRef<HTMLFormElement>(null);
  const todos = linhas.length > 0 && selecionados.size === linhas.length;
  const ids = useMemo(() => [...selecionados], [selecionados]);
  const clientes = linhas.filter((l) => selecionados.has(l.id) && l.direcao === "cliente").map((l) => l.id);

  function alternar(id: string) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function mudarStatus(status: string, texto = "") {
    return new Promise<void>((resolve) => {
      iniciar(async () => {
        let r: ResultadoAcao;
        if (multiempresa || !empresaId) r = await alterarStatusEmLote(clientes, status, texto);
        else r = await alterarStatusDocumentos(empresaId, clientes, status, texto);
        if (r.ok) {
          toast.success(r.mensagem ?? "Documentos atualizados.");
          setSelecionados(new Set());
          setMotivo("");
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível atualizar.");
        resolve();
      });
    });
  }

  return (
    <div className="space-y-3">
      {selecionados.size ? (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          <span className="px-1 text-sm font-medium">{selecionados.size} selecionado(s)</span>
          {podeBaixar ? (
            <Button
              tamanho="sm"
              variante="contorno"
              onClick={() => {
                formLote.current?.submit();
                toast.info("Preparando o arquivo ZIP. O download começa em instantes.");
              }}
            >
              <FileArchive /> Baixar em ZIP
            </Button>
          ) : null}
          {podeRevisar && clientes.length ? (
            <>
              <Button tamanho="sm" variante="contorno" disabled={pendente} onClick={() => mudarStatus("em_analise")}>
                <Search /> Em análise
              </Button>
              <Confirmacao
                gatilho={
                  <Button tamanho="sm" variante="sucesso" disabled={pendente}>
                    <CheckCheck /> Aprovar
                  </Button>
                }
                titulo={`Aprovar ${clientes.length} documento(s)?`}
                descricao="A aprovação indica conferência interna do escritório e não representa validação fiscal. Arquivos extraídos de ZIPs selecionados também serão aprovados."
                textoConfirmar="Aprovar"
                aoConfirmar={() => mudarStatus("aprovado")}
              />
              <Confirmacao
                gatilho={
                  <Button tamanho="sm" variante="perigo" disabled={pendente}>
                    <AlertTriangle /> Pedir correção
                  </Button>
                }
                titulo="Pedir correção ao cliente"
                descricao="O cliente será avisado no portal e por e-mail com a explicação abaixo."
                textoConfirmar="Enviar pedido de correção"
                variante="perigo"
                aoConfirmar={async () => {
                  if (!motivo.trim()) {
                    toast.error("Explique o que precisa ser corrigido.");
                    return false;
                  }
                  await mudarStatus("correcao", motivo);
                }}
              >
                <Textarea aria-label="Motivo da correção" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: o extrato está incompleto — faltam os dias 20 a 30." rows={3} />
              </Confirmacao>
            </>
          ) : null}
          <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionados(new Set())}>
            Limpar seleção
          </Button>
          {pendente ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}

      <form ref={formLote} method="post" action="/api/documentos/lote" className="hidden">
        {ids.map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
      </form>

      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox
                aria-label="Selecionar todos"
                checked={todos}
                onChange={() => setSelecionados(todos ? new Set() : new Set(linhas.map((l) => l.id)))}
              />
            </Th>
            <Th>Documento</Th>
            {multiempresa ? <Th>Empresa</Th> : null}
            <Th>Competência</Th>
            <Th>Recebido em</Th>
            <Th>Situação</Th>
            <Th className="text-right">Tamanho</Th>
            <Th className="w-10">
              <span className="sr-only">Ações</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => {
            const st = l.status ? STATUS_DOCUMENTO[l.status] : null;
            return (
              <Tr key={l.id} data-state={selecionados.has(l.id) ? "selected" : undefined} className="data-[state=selected]:bg-bege/40">
                <Td>
                  <Checkbox aria-label={`Selecionar ${l.nome}`} checked={selecionados.has(l.id)} onChange={() => alternar(l.id)} />
                </Td>
                <Td className="max-w-[22rem]">
                  <Link href={hrefDocumento(l)} className="block truncate font-medium text-foreground hover:underline" title={l.titulo ?? l.nome}>
                    {l.titulo ?? l.nome}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.categoria}
                    {l.zip_origem_id ? " · extraído de ZIP" : ""}
                    {l.versao_atual > 1 ? ` · versão ${l.versao_atual}` : ""}
                    {l.direcao === "escritorio" && l.vencimento ? ` · vence ${formatarData(l.vencimento)}` : ""}
                  </span>
                </Td>
                {multiempresa ? <Td className="max-w-[14rem] truncate text-sm">{l.empresa_nome}</Td> : null}
                <Td className="whitespace-nowrap">{formatarCompetencia(l.competencia)}</Td>
                <Td className="whitespace-nowrap text-sm">
                  {formatarDataHora(l.enviado_em)}
                  {l.enviado_por ? <span className="block text-xs text-muted-foreground">{l.enviado_por}</span> : null}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {l.direcao === "escritorio" ? <Badge variante="primario">Do escritório</Badge> : st ? <Badge variante={st.tom}>{st.rotulo}</Badge> : null}
                    {l.verificacao_status === "bloqueado" ? (
                      <Badge variante="perigo">
                        <ShieldAlert /> Bloqueado
                      </Badge>
                    ) : null}
                    {l.recebido_apos_fechamento ? (
                      <Badge variante="alerta">
                        <Lock /> Após fechamento
                      </Badge>
                    ) : null}
                    {podeRevisar && l.requer_conferencia ? <Badge variante="alerta">Conferir leitura</Badge> : null}
                    {podeRevisar && l.sugestao ? (
                      <Badge variante="info">
                        <Sparkles /> Sugestão
                      </Badge>
                    ) : null}
                    {l.processamento_status === "pendente" || l.processamento_status === "processando" ? <Badge variante="neutro">Processando</Badge> : null}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right text-sm text-muted-foreground">{formatarTamanho(l.tamanho)}</Td>
                <Td>
                  {podeBaixar && l.verificacao_status !== "bloqueado" ? (
                    <Button asChild variante="fantasma" tamanho="iconeSm" aria-label={`Baixar ${l.nome}`}>
                      <a href={`/api/documentos/${l.id}/arquivo?modo=baixar`}>
                        <Download />
                      </a>
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
