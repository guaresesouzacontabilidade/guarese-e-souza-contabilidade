"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  FileText,
  History,
  MessageSquareWarning,
  Pencil,
  Plus,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { STATUS_CHECKLIST, STATUS_DOCUMENTO } from "@/lib/rotulos";
import type { ResultadoAcao } from "@/lib/acoes";
import {
  adicionarItem,
  atualizarItem,
  concluirItem,
  enviarLembrete,
  reabrirItem,
  revisarNaoAplica,
  solicitarCorrecaoItem,
  solicitarNaoAplica,
} from "@/lib/checklist/acoes";

export interface DocumentoItem {
  id: string;
  nome: string;
  status: string | null;
  enviado_em: string | null;
}

export interface HistoricoItem {
  id: number;
  acao: string;
  status_novo: string | null;
  motivo: string | null;
  alterado_em: string;
  autor: string | null;
}

export interface ItemChecklist {
  id: string;
  titulo: string;
  descricao: string | null;
  categoria_codigo: string;
  categoria_nome: string;
  obrigatorio: boolean;
  quantidade_minima: number;
  prazo: string;
  status: string;
  correcao_motivo: string | null;
  nao_aplica_justificativa: string | null;
  nao_aplica_resposta: string | null;
  conclusao_observacao: string | null;
  observacao_equipe: string | null;
  responsavel_cliente_id: string | null;
  responsavel_equipe_id: string | null;
  responsavel_cliente: string | null;
  responsavel_equipe: string | null;
  documentos: DocumentoItem[];
  historico: HistoricoItem[];
}

interface Opcao {
  id: string;
  nome: string;
}

const ACOES_HISTORICO: Record<string, string> = {
  criado: "Item criado",
  recalculo: "Situação atualizada pelos documentos",
  nao_se_aplica: "Marcado como “não se aplica”",
  nao_se_aplica_aprovado: "“Não se aplica” aprovado",
  nao_se_aplica_recusado: "“Não se aplica” recusado",
  concluido_manual: "Concluído pela equipe",
  reaberto: "Reaberto",
  correcao_solicitada: "Correção solicitada",
};

function useExecutarAcao() {
  const router = useRouter();
  return async (fn: () => Promise<ResultadoAcao>) => {
    const r = await fn();
    if (r.ok) {
      toast.success(r.mensagem ?? "Feito.");
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível concluir.");
    return false;
  };
}

/** Diálogo com um campo de texto (justificativa, motivo, parecer...). */
function AcaoComTexto({
  gatilho,
  titulo,
  descricao,
  rotulo,
  obrigatorio = true,
  textoConfirmar,
  perigo,
  executar,
}: {
  gatilho: React.ReactNode;
  titulo: string;
  descricao?: string;
  rotulo: string;
  obrigatorio?: boolean;
  textoConfirmar: string;
  perigo?: boolean;
  executar: (texto: string) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState("");
  return (
    <Confirmacao
      gatilho={gatilho}
      titulo={titulo}
      descricao={descricao}
      textoConfirmar={textoConfirmar}
      variante={perigo ? "perigo" : "primario"}
      aoConfirmar={async () => {
        if (obrigatorio && !texto.trim()) {
          toast.error("Preencha o campo para continuar.");
          return false;
        }
        const ok = await executar(texto.trim());
        if (ok) setTexto("");
        return ok;
      }}
    >
      <Textarea aria-label={rotulo} placeholder={rotulo} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} />
    </Confirmacao>
  );
}

export function ItensCompetencia({
  empresaId,
  competencia,
  itens,
  hoje,
  podeEnviar,
  podeGerenciar,
  categorias,
  clientes,
  equipe,
}: {
  empresaId: string;
  competencia: string; // AAAA-MM
  itens: ItemChecklist[];
  hoje: string;
  podeEnviar: boolean;
  podeGerenciar: boolean;
  categorias: { codigo: string; nome: string }[];
  clientes: Opcao[];
  equipe: Opcao[];
}) {
  const executar = useExecutarAcao();
  const [editando, setEditando] = useState<ItemChecklist | "novo" | null>(null);

  return (
    <div className="space-y-3">
      {podeGerenciar ? (
        <div className="flex flex-wrap justify-end gap-2">
          <AcaoComTexto
            gatilho={
              <Button variante="contorno">
                <BellRing /> Enviar lembrete
              </Button>
            }
            titulo="Enviar lembrete das pendências"
            descricao="Os responsáveis da empresa recebem a lista do que falta (no portal e por e-mail, se ativado)."
            rotulo="Mensagem opcional (ex.: precisamos dos extratos até sexta)"
            obrigatorio={false}
            textoConfirmar="Enviar lembrete"
            executar={(t) => executar(() => enviarLembrete(empresaId, competencia, t))}
          />
          <Button onClick={() => setEditando("novo")}>
            <Plus /> Solicitar documento
          </Button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {itens.map((i) => (
          <LinhaItem
            key={i.id}
            item={i}
            empresaId={empresaId}
            hoje={hoje}
            podeEnviar={podeEnviar}
            podeGerenciar={podeGerenciar}
            executar={executar}
            aoEditar={() => setEditando(i)}
          />
        ))}
      </ul>

      {editando ? (
        <Dialog open onOpenChange={(v) => !v && setEditando(null)}>
          <DialogContent
            titulo={editando === "novo" ? "Solicitar documento ao cliente" : "Editar item"}
            descricao={editando === "novo" ? "O cliente é avisado no portal e por e-mail." : "As alterações valem somente para esta competência."}
          >
            <FormularioAcao
              acao={editando === "novo" ? adicionarItem.bind(null, empresaId) : atualizarItem.bind(null, empresaId, editando.id)}
              aoSucesso={() => setEditando(null)}
              className="space-y-4"
            >
              {({ estado, pendente }) => {
                const e = editando === "novo" ? null : editando;
                return (
                  <>
                    <input type="hidden" name="competencia" value={competencia} />
                    {editando === "novo" ? (
                      <Campo rotulo="Tipo de documento" htmlFor="it-cat" obrigatorio erro={estado.erros?.categoria_codigo}>
                        <Select id="it-cat" name="categoria_codigo" defaultValue="outros">
                          {categorias.map((c) => (
                            <option key={c.codigo} value={c.codigo}>
                              {c.nome}
                            </option>
                          ))}
                        </Select>
                      </Campo>
                    ) : null}
                    <Campo rotulo="Título" htmlFor="it-titulo" obrigatorio erro={estado.erros?.titulo}>
                      <Input id="it-titulo" name="titulo" defaultValue={e?.titulo ?? ""} maxLength={200} />
                    </Campo>
                    <Campo rotulo="Descrição / orientação ao cliente" htmlFor="it-desc">
                      <Textarea id="it-desc" name="descricao" defaultValue={e?.descricao ?? ""} />
                    </Campo>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Prazo" htmlFor="it-prazo" obrigatorio erro={estado.erros?.prazo}>
                        <Input id="it-prazo" name="prazo" type="date" defaultValue={e?.prazo ?? ""} />
                      </Campo>
                      <Campo rotulo="Quantidade mínima de arquivos" htmlFor="it-qtd">
                        <Input id="it-qtd" name="quantidade_minima" type="number" min={1} max={100} defaultValue={e?.quantidade_minima ?? 1} />
                      </Campo>
                      <Campo rotulo="Responsável na empresa" htmlFor="it-rc">
                        <Select id="it-rc" name="responsavel_cliente_id" defaultValue={e?.responsavel_cliente_id ?? ""}>
                          <option value="">—</option>
                          {clientes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </Select>
                      </Campo>
                      <Campo rotulo="Responsável no escritório" htmlFor="it-re">
                        <Select id="it-re" name="responsavel_equipe_id" defaultValue={e?.responsavel_equipe_id ?? ""}>
                          <option value="">—</option>
                          {equipe.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </Select>
                      </Campo>
                    </div>
                    {e ? (
                      <Campo rotulo="Observação interna da equipe" htmlFor="it-obs" ajuda="Não aparece para o cliente.">
                        <Textarea id="it-obs" name="observacao_equipe" defaultValue={e.observacao_equipe ?? ""} rows={2} />
                      </Campo>
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <input type="hidden" name="obrigatorio" value="false" />
                      <Checkbox name="obrigatorio" defaultChecked={e?.obrigatorio ?? true} /> Obrigatório (conta no percentual de entrega)
                    </label>
                    <div className="flex justify-end">
                      <BotaoEnviar pendente={pendente}>{editando === "novo" ? "Solicitar" : "Salvar"}</BotaoEnviar>
                    </div>
                  </>
                );
              }}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function LinhaItem({
  item: i,
  empresaId,
  hoje,
  podeEnviar,
  podeGerenciar,
  executar,
  aoEditar,
}: {
  item: ItemChecklist;
  empresaId: string;
  hoje: string;
  podeEnviar: boolean;
  podeGerenciar: boolean;
  executar: (fn: () => Promise<ResultadoAcao>) => Promise<boolean>;
  aoEditar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const st = STATUS_CHECKLIST[i.status] ?? { rotulo: i.status, tom: "neutro" as const };
  const aberta = i.status === "pendente" || i.status === "correcao";
  const atrasado = aberta && i.prazo < hoje;
  const encerrado = i.status === "concluido" || i.status === "nao_se_aplica";

  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-sm", atrasado ? "border-perigo/40" : "border-border")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {encerrado ? <CheckCircle2 className="size-4 text-sucesso" aria-hidden="true" /> : <FileText className="size-4 text-muted-foreground" aria-hidden="true" />}
            <h3 className="font-semibold text-titulo">{i.titulo}</h3>
            <Badge variante={st.tom}>{st.rotulo}</Badge>
            {atrasado ? <Badge variante="perigo">Atrasado</Badge> : null}
            {!i.obrigatorio ? <Badge variante="contorno">Opcional</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {i.categoria_nome} · prazo {formatarData(i.prazo)}
            {i.quantidade_minima > 1 ? ` · mínimo de ${i.quantidade_minima} arquivos` : ""}
            {i.responsavel_cliente ? ` · responsável: ${i.responsavel_cliente}` : ""}
          </p>
          {i.descricao ? <p className="text-sm">{i.descricao}</p> : null}
          {i.status === "correcao" && i.correcao_motivo ? (
            <p className="flex gap-1.5 rounded-md bg-perigo-bg px-2 py-1 text-sm text-perigo-fg">
              <MessageSquareWarning className="mt-0.5 size-4 shrink-0" /> {i.correcao_motivo}
            </p>
          ) : null}
          {i.status.startsWith("nao_se_aplica") && i.nao_aplica_justificativa ? (
            <p className="text-sm text-muted-foreground">
              Justificativa: {i.nao_aplica_justificativa}
              {i.nao_aplica_resposta ? ` · Resposta do escritório: ${i.nao_aplica_resposta}` : ""}
            </p>
          ) : null}
          {i.status === "pendente" && i.nao_aplica_resposta ? (
            <p className="text-sm text-alerta-fg">O escritório informou que este item continua necessário: {i.nao_aplica_resposta}</p>
          ) : null}
          {i.status === "concluido" && i.conclusao_observacao ? <p className="text-sm text-muted-foreground">Observação: {i.conclusao_observacao}</p> : null}
          {podeGerenciar && i.observacao_equipe ? <p className="text-xs text-info-fg">Nota interna: {i.observacao_equipe}</p> : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {podeEnviar && !encerrado && i.status !== "nao_se_aplica_solicitado" ? (
            <Button asChild tamanho="sm">
              <Link href={`/e/${empresaId}/enviar?item=${i.id}`}>
                <Upload /> {i.documentos.length ? "Enviar mais" : "Enviar"}
              </Link>
            </Button>
          ) : null}
          {(podeEnviar || podeGerenciar) && aberta ? (
            <AcaoComTexto
              gatilho={
                <Button tamanho="sm" variante="contorno">
                  <CircleSlash /> Não se aplica
                </Button>
              }
              titulo="Este item não se aplica neste mês?"
              descricao={podeGerenciar ? "O item será marcado como “não se aplica”." : "O escritório vai revisar a sua justificativa. Até lá, o item fica em revisão."}
              rotulo="Explique o motivo (ex.: não houve movimentação nesta conta no mês)"
              textoConfirmar={podeGerenciar ? "Marcar" : "Enviar para revisão"}
              executar={(t) => executar(() => solicitarNaoAplica(empresaId, i.id, t))}
            />
          ) : null}
          {podeGerenciar && i.status === "nao_se_aplica_solicitado" ? (
            <>
              <Button tamanho="sm" variante="sucesso" onClick={() => executar(() => revisarNaoAplica(empresaId, i.id, true, ""))}>
                <ThumbsUp /> Aceitar “não se aplica”
              </Button>
              <AcaoComTexto
                gatilho={
                  <Button tamanho="sm" variante="contorno">
                    <ThumbsDown /> Recusar
                  </Button>
                }
                titulo="Recusar “não se aplica”"
                rotulo="Explique ao cliente por que o documento continua necessário"
                textoConfirmar="Recusar"
                executar={(t) => executar(() => revisarNaoAplica(empresaId, i.id, false, t))}
              />
            </>
          ) : null}
          {podeGerenciar && !encerrado && i.status !== "nao_se_aplica_solicitado" ? (
            <AcaoComTexto
              gatilho={
                <Button tamanho="sm" variante="secundario">
                  <CheckCircle2 /> Concluir
                </Button>
              }
              titulo="Concluir este item"
              descricao="Se ainda não houver o mínimo de documentos aprovados, a justificativa é obrigatória."
              rotulo="Observação / justificativa"
              obrigatorio={false}
              textoConfirmar="Concluir"
              executar={(t) => executar(() => concluirItem(empresaId, i.id, t))}
            />
          ) : null}
          {podeGerenciar && !encerrado && i.documentos.length ? (
            <AcaoComTexto
              gatilho={
                <Button tamanho="sm" variante="fantasma">
                  <MessageSquareWarning /> Pedir complemento
                </Button>
              }
              titulo="Pedir correção ou complemento"
              descricao="O cliente será avisado; só os envios feitos depois deste pedido contam para concluir o item."
              rotulo="O que precisa ser corrigido ou complementado"
              textoConfirmar="Enviar pedido"
              perigo
              executar={(t) => executar(() => solicitarCorrecaoItem(empresaId, i.id, t))}
            />
          ) : null}
          {podeGerenciar && encerrado ? (
            <AcaoComTexto
              gatilho={
                <Button tamanho="sm" variante="fantasma">
                  <RotateCcw /> Reabrir
                </Button>
              }
              titulo="Reabrir item"
              rotulo="Motivo da reabertura"
              textoConfirmar="Reabrir"
              executar={(t) => executar(() => reabrirItem(empresaId, i.id, t))}
            />
          ) : null}
          {podeGerenciar ? (
            <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${i.titulo}`} onClick={aoEditar}>
              <Pencil />
            </Button>
          ) : null}
        </div>
      </div>

      {i.documentos.length || i.historico.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <button type="button" onClick={() => setAberto((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={aberto}>
            <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
            {i.documentos.length} documento(s) enviado(s) · histórico
          </button>
          {aberto ? (
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <ul className="space-y-1 text-sm">
                {i.documentos.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <Link href={`/e/${empresaId}/documentos/${d.id}`} className="truncate hover:underline">
                      {d.nome}
                    </Link>
                    {d.status ? <Badge variante={STATUS_DOCUMENTO[d.status]?.tom ?? "neutro"}>{STATUS_DOCUMENTO[d.status]?.rotulo ?? d.status}</Badge> : null}
                  </li>
                ))}
                {!i.documentos.length ? <li className="text-muted-foreground">Nenhum arquivo enviado.</li> : null}
              </ul>
              <ol className="space-y-1.5 text-xs">
                {i.historico.map((h) => (
                  <li key={h.id} className="flex gap-1.5">
                    <History className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="font-medium">{ACOES_HISTORICO[h.acao] ?? h.acao}</span>
                      {h.acao === "recalculo" && h.status_novo ? `: ${STATUS_CHECKLIST[h.status_novo]?.rotulo ?? h.status_novo}` : ""}
                      {h.motivo ? ` — ${h.motivo}` : ""}
                      <span className="block text-muted-foreground">
                        {formatarDataHora(h.alterado_em)}
                        {h.autor ? ` · ${h.autor}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
