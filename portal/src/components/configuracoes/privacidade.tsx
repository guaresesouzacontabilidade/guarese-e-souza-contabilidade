"use client";

import { useState } from "react";
import { MessageSquareReply, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/formatos";
import {
  excluirPoliticaRetencao,
  responderSolicitacao,
  salvarPoliticaRetencao,
  salvarRetencaoPadrao,
} from "@/app/(app)/escritorio/configuracoes/acoes";

export function FormularioRetencaoPadrao({ anos }: { anos: number }) {
  return (
    <FormularioAcao acao={salvarRetencaoPadrao} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {({ estado, pendente }) => (
        <>
          <Campo
            rotulo="Prazo padrão de retenção (anos)"
            htmlFor="cfg-retencao"
            erro={estado.erros?.retencao_padrao_anos}
            ajuda="Contado a partir do fim da competência do documento. Vale para as categorias sem política própria."
            className="sm:max-w-sm"
          >
            <Input id="cfg-retencao" name="retencao_padrao_anos" type="number" min={1} max={50} defaultValue={anos} />
          </Campo>
          <BotaoEnviar pendente={pendente} className="sm:mb-6">
            <Save /> Salvar
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}

export interface PoliticaRetencao {
  categoria_codigo: string;
  anos: number;
  observacao: string | null;
  updated_at: string;
}

export function PoliticasRetencao({ politicas, categorias }: { politicas: PoliticaRetencao[]; categorias: { codigo: string; nome: string }[] }) {
  const [editando, setEditando] = useState<PoliticaRetencao | "nova" | null>(null);
  const nomes = new Map(categorias.map((c) => [c.codigo, c.nome]));
  const usadas = new Set(politicas.map((p) => p.categoria_codigo));
  const disponiveis = categorias.filter((c) => !usadas.has(c.codigo));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variante="contorno" onClick={() => setEditando("nova")} disabled={!disponiveis.length}>
          <Plus /> Nova política por categoria
        </Button>
      </div>
      {politicas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Categoria</Th>
              <Th>Prazo</Th>
              <Th className="hidden md:table-cell">Observação</Th>
              <Th className="w-24" />
            </tr>
          </THead>
          <TBody>
            {politicas.map((p) => (
              <Tr key={p.categoria_codigo}>
                <Td className="text-sm font-medium">{nomes.get(p.categoria_codigo) ?? p.categoria_codigo}</Td>
                <Td className="whitespace-nowrap text-sm">{p.anos} ano(s)</Td>
                <Td className="hidden text-xs text-muted-foreground md:table-cell">{p.observacao ?? "—"}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variante="fantasma" tamanho="iconeSm" aria-label="Editar política" onClick={() => setEditando(p)}>
                      <Pencil />
                    </Button>
                    <BotaoAcao
                      variante="fantasma"
                      tamanho="iconeSm"
                      aria-label="Remover política"
                      acao={excluirPoliticaRetencao.bind(null, p.categoria_codigo)}
                      confirmar={{
                        titulo: "Remover esta política?",
                        descricao: "A categoria passa a usar o prazo padrão de retenção do escritório.",
                        textoConfirmar: "Remover",
                        perigo: true,
                      }}
                    >
                      <Trash2 />
                    </BotaoAcao>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio titulo="Nenhuma política por categoria" descricao="Todas as categorias usam o prazo padrão de retenção." />
      )}

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando !== null ? (
          <DialogContent titulo={editando === "nova" ? "Nova política de retenção" : "Editar política de retenção"}>
            <FormularioAcao acao={salvarPoliticaRetencao} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  <Campo rotulo="Categoria de documento" htmlFor="pol-categoria" obrigatorio erro={estado.erros?.categoria_codigo}>
                    {editando === "nova" ? (
                      <Select id="pol-categoria" name="categoria_codigo" defaultValue="">
                        <option value="" disabled>
                          Selecione
                        </option>
                        {disponiveis.map((c) => (
                          <option key={c.codigo} value={c.codigo}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <>
                        <Input id="pol-categoria" value={nomes.get(editando.categoria_codigo) ?? editando.categoria_codigo} readOnly />
                        <input type="hidden" name="categoria_codigo" value={editando.categoria_codigo} />
                      </>
                    )}
                  </Campo>
                  <Campo rotulo="Prazo (anos)" htmlFor="pol-anos" obrigatorio erro={estado.erros?.anos}>
                    <Input id="pol-anos" name="anos" type="number" min={1} max={50} defaultValue={editando === "nova" ? 6 : editando.anos} />
                  </Campo>
                  <Campo rotulo="Observação (fundamento)" htmlFor="pol-obs" erro={estado.erros?.observacao}>
                    <Textarea id="pol-obs" name="observacao" defaultValue={editando === "nova" ? "" : (editando.observacao ?? "")} />
                  </Campo>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>
                      <Save /> Salvar política
                    </BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

const TIPOS_SOLICITACAO: Record<string, string> = {
  acesso: "Acesso aos dados",
  correcao: "Correção de dados",
  anonimizacao: "Anonimização",
  exclusao: "Exclusão",
  portabilidade: "Portabilidade",
  informacao: "Informação sobre o tratamento",
  revogacao_consentimento: "Revogação de consentimento",
};

const STATUS_SOLICITACAO: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  aberta: { rotulo: "Aberta", tom: "alerta" },
  em_andamento: { rotulo: "Em andamento", tom: "info" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  recusada: { rotulo: "Recusada", tom: "neutro" },
};

export interface SolicitacaoTitular {
  id: string;
  tipo: string;
  descricao: string | null;
  status: string;
  resposta: string | null;
  email: string | null;
  nome: string | null;
  created_at: string;
  respondida_em: string | null;
}

export function SolicitacoesTitular({ solicitacoes }: { solicitacoes: SolicitacaoTitular[] }) {
  const [respondendo, setRespondendo] = useState<SolicitacaoTitular | null>(null);
  if (!solicitacoes.length) {
    return <EstadoVazio titulo="Nenhuma solicitação de titular" descricao="Pedidos de acesso, correção ou exclusão de dados pessoais feitos pelos usuários aparecem aqui." />;
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <Th>Solicitante</Th>
            <Th>Tipo</Th>
            <Th className="hidden md:table-cell">Recebida em</Th>
            <Th>Situação</Th>
            <Th className="w-28" />
          </tr>
        </THead>
        <TBody>
          {solicitacoes.map((s) => {
            const st = STATUS_SOLICITACAO[s.status] ?? { rotulo: s.status, tom: "neutro" as const };
            return (
              <Tr key={s.id}>
                <Td>
                  <p className="text-sm font-medium">{s.nome ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{s.email ?? "—"}</p>
                </Td>
                <Td className="text-sm">
                  {TIPOS_SOLICITACAO[s.tipo] ?? s.tipo}
                  {s.descricao ? <p className="line-clamp-2 max-w-sm text-xs text-muted-foreground">{s.descricao}</p> : null}
                </Td>
                <Td className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">{formatarDataHora(s.created_at)}</Td>
                <Td>
                  <Badge variante={st.tom}>{st.rotulo}</Badge>
                </Td>
                <Td>
                  <Button variante="contorno" tamanho="sm" onClick={() => setRespondendo(s)}>
                    <MessageSquareReply /> {s.status === "aberta" || s.status === "em_andamento" ? "Responder" : "Ver"}
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      <Dialog open={Boolean(respondendo)} onOpenChange={(v) => !v && setRespondendo(null)}>
        {respondendo ? (
          <DialogContent
            largura="lg"
            titulo={TIPOS_SOLICITACAO[respondendo.tipo] ?? respondendo.tipo}
            descricao={`${respondendo.nome ?? respondendo.email ?? "Titular"} · recebida em ${formatarDataHora(respondendo.created_at)}`}
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pedido do titular</p>
                <p className="mt-1 whitespace-pre-wrap">{respondendo.descricao || "Sem descrição."}</p>
              </div>
              {respondendo.resposta ? (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Última resposta {respondendo.respondida_em ? `(${formatarDataHora(respondendo.respondida_em)})` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{respondendo.resposta}</p>
                </div>
              ) : null}
              <FormularioAcao acao={responderSolicitacao} aoSucesso={() => setRespondendo(null)} className="space-y-4">
                {({ estado, pendente }) => (
                  <>
                    <input type="hidden" name="id" value={respondendo.id} />
                    <Campo rotulo="Situação" htmlFor="sol-status" obrigatorio erro={estado.erros?.status}>
                      <Select id="sol-status" name="status" defaultValue={respondendo.status === "aberta" ? "em_andamento" : respondendo.status}>
                        <option value="em_andamento">Em andamento</option>
                        <option value="concluida">Concluída</option>
                        <option value="recusada">Recusada (com justificativa)</option>
                      </Select>
                    </Campo>
                    <Campo rotulo="Resposta ao titular" htmlFor="sol-resposta" obrigatorio erro={estado.erros?.resposta} ajuda="O titular é notificado no portal e por e-mail.">
                      <Textarea id="sol-resposta" name="resposta" rows={5} />
                    </Campo>
                    <div className="flex justify-end">
                      <BotaoEnviar pendente={pendente}>Registrar resposta</BotaoEnviar>
                    </div>
                  </>
                )}
              </FormularioAcao>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
