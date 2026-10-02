import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Lock, ShieldAlert, Sparkles } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { LeituraDocumento } from "@/components/documentos/leitura-documento";
import {
  AcoesConferencia,
  AvaliarAposFechamento,
  ExcluirDocumento,
  ReclassificarDocumento,
  SubstituirArquivo,
  Visualizador,
} from "@/components/documentos/acoes-documento";
import { aplicarSugestao, reprocessarDocumento } from "@/lib/documentos/acoes";
import { listaCompetencias, somarMeses, competenciaAtual } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora, formatarTamanho } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { ACAO_HISTORICO_DOCUMENTO, ORIGEM_DOCUMENTO, STATUS_DOCUMENTO, VERIFICACAO } from "@/lib/rotulos";
import { MIME_VISUALIZACAO_SEGURA } from "@/lib/arquivos/tipos";
import { protocolo } from "@/lib/utils";

export const metadata: Metadata = { title: "Documento" };
const UUID = /^[0-9a-f-]{36}$/i;

type Nome = { nome: string } | null;

export default async function PaginaDocumento({ params }: PageProps<"/e/[empresaId]/documentos/[documentoId]">) {
  const { empresaId, documentoId } = await params;
  if (!UUID.test(documentoId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.ver")) return <Alerta tom="alerta">Seu acesso não inclui a consulta de documentos desta empresa.</Alerta>;

  const { data: doc } = await ctx.supabase
    .from("documentos")
    .select("*, autor:perfis!documentos_enviado_por_fkey(nome), conferente:perfis!documentos_status_alterado_por_fkey(nome), item:checklist_itens!documentos_checklist_item_fk(id, titulo, status)")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!doc) notFound();

  const revisor = ctx.pode("documentos.revisar");
  const escritorio = doc.direcao === "escritorio";
  const base = `/e/${empresaId}/documentos`;

  const [versoes, historico, acessos, categorias, itens, filhos, escritorioCfg, original] = await Promise.all([
    ctx.supabase
      .from("documento_versoes")
      .select("id, versao, nome_original, tamanho, motivo, criado_em, upload_concluido_em, verificacao_status, autor:perfis!documento_versoes_enviado_por_fkey(nome)")
      .eq("documento_id", documentoId)
      .order("versao", { ascending: false }),
    ctx.supabase
      .from("documento_historico")
      .select("id, acao, status_anterior, status_novo, motivo, alterado_em, autor:perfis!documento_historico_alterado_por_fkey(nome)")
      .eq("documento_id", documentoId)
      .order("alterado_em", { ascending: false })
      .limit(50),
    ctx.supabase
      .from("documento_acessos")
      .select("id, tipo, versao, ocorrido_em, usuario:perfis!documento_acessos_user_id_fkey(nome)")
      .eq("documento_id", documentoId)
      .order("ocorrido_em", { ascending: false })
      .limit(20),
    ctx.supabase.from("categorias_documento").select("codigo, nome, extensoes, escritorio").eq("ativo", true).order("ordem"),
    ctx.supabase
      .from("checklist_itens")
      .select("id, titulo, competencia, categoria_codigo")
      .eq("empresa_id", empresaId)
      .gte("competencia", somarMeses(competenciaAtual(), -24))
      .order("titulo"),
    doc.extensao === "zip"
      ? ctx.supabase
          .from("documentos")
          .select("id, nome_original, status, categoria_codigo", { count: "exact" })
          .eq("zip_origem_id", documentoId)
          .is("excluido_em", null)
          .order("nome_original")
          .limit(100)
      : Promise.resolve({ data: null, count: 0 }),
    ctx.supabase.from("escritorio").select("upload_tamanho_maximo_mb").single(),
    doc.duplicado_de ? ctx.supabase.from("documentos").select("id, nome_original, enviado_em").eq("id", doc.duplicado_de).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const cats = categorias.data ?? [];
  const categoria = cats.find((c) => c.codigo === doc.categoria_codigo);
  const st = doc.status ? STATUS_DOCUMENTO[doc.status] : null;
  const ver = VERIFICACAO[doc.verificacao_status];
  const bloqueado = doc.verificacao_status === "bloqueado";
  const podeBaixar = ctx.pode("documentos.baixar") && (!bloqueado || revisor);
  const podeEditar = escritorio ? ctx.pode("documentos.publicar") : revisor || (ctx.pode("documentos.enviar") && ["recebido", "correcao"].includes(doc.status ?? ""));
  const podeExcluir = escritorio ? ctx.pode("documentos.publicar") : revisor || (ctx.pode("documentos.enviar") && doc.status === "recebido");
  const visualizavel = MIME_VISUALIZACAO_SEGURA.has(doc.mime ?? "") && !bloqueado;
  const sugestao = (doc.sugestao ?? null) as { categoria?: string; competencia?: string; motivo?: string } | null;
  const sugestaoUtil =
    sugestao && ((sugestao.categoria && sugestao.categoria !== doc.categoria_codigo) || (sugestao.competencia && sugestao.competencia !== doc.competencia)) ? sugestao : null;
  const item = doc.item as { id: string; titulo: string; status: string } | null;
  const titulo = doc.titulo ?? doc.nome_original;

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: escritorio ? `${base}?origem=escritorio` : base, rotulo: "Documentos" }}
        titulo={<span className="break-all">{titulo}</span>}
        descricao={
          <>
            {categoria?.nome ?? doc.categoria_codigo} · competência {formatarCompetencia(doc.competencia, true)}
          </>
        }
        acoes={
          podeBaixar ? (
            <Button asChild>
              <a href={`/api/documentos/${doc.id}/arquivo?modo=baixar`}>
                <Download /> Baixar
              </a>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {escritorio ? <Badge variante="primario">Disponibilizado pelo escritório</Badge> : st ? <Badge variante={st.tom}>{st.rotulo}</Badge> : null}
        {doc.excluido_em ? <Badge variante="perigo">Excluído</Badge> : null}
        {bloqueado ? (
          <Badge variante="perigo">
            <ShieldAlert /> Bloqueado pela verificação de segurança
          </Badge>
        ) : null}
        {doc.recebido_apos_fechamento ? (
          <Badge variante="alerta">
            <Lock /> Recebido após o fechamento do mês
          </Badge>
        ) : null}
        {doc.versao_atual > 1 ? <Badge variante="neutro">Versão {doc.versao_atual}</Badge> : null}
      </div>

      {doc.excluido_em ? (
        <Alerta tom="alerta" className="mb-4" titulo={`Excluído em ${formatarDataHora(doc.excluido_em)}`}>
          {doc.motivo_exclusao}
        </Alerta>
      ) : null}
      {doc.status === "correcao" && doc.status_motivo ? (
        <Alerta tom="perigo" className="mb-4" titulo="O escritório pediu uma correção">
          {doc.status_motivo}
          {!escritorio && ctx.pode("documentos.enviar") ? " Use “Substituir arquivo” para enviar a versão corrigida." : ""}
        </Alerta>
      ) : null}
      {original.data ? (
        <Alerta tom="info" className="mb-4">
          Este arquivo é idêntico ao documento{" "}
          <Link className="underline" href={`${base}/${original.data.id}`}>
            {original.data.nome_original}
          </Link>{" "}
          enviado em {formatarDataHora(original.data.enviado_em)}. O envio foi mantido por decisão de quem enviou.
        </Alerta>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          {podeBaixar && visualizavel ? (
            <Card>
              <CardHeader>
                <CardTitle>Arquivo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Visualizador href={`/api/documentos/${doc.id}/arquivo?modo=ver`} tipo={doc.mime === "application/pdf" ? "pdf" : "imagem"} nome={doc.nome_original} />
                <p className="text-xs text-muted-foreground">
                  <a className="inline-flex items-center gap-1 underline" href={`/api/documentos/${doc.id}/arquivo?modo=ver`} target="_blank" rel="noopener noreferrer">
                    Abrir em nova aba <ExternalLink className="size-3" />
                  </a>
                </p>
              </CardContent>
            </Card>
          ) : null}

          {sugestaoUtil ? (
            <Alerta
              tom="info"
              titulo="Sugestão da leitura automática"
              acao={
                podeEditar ? (
                  <BotaoAcao tamanho="sm" variante="secundario" acao={aplicarSugestao.bind(null, empresaId, doc.id)}>
                    <Sparkles /> Aplicar
                  </BotaoAcao>
                ) : null
              }
            >
              {sugestaoUtil.categoria && sugestaoUtil.categoria !== doc.categoria_codigo ? `Tipo: ${cats.find((c) => c.codigo === sugestaoUtil.categoria)?.nome ?? sugestaoUtil.categoria}. ` : ""}
              {sugestaoUtil.competencia && sugestaoUtil.competencia !== doc.competencia ? `Competência: ${formatarCompetencia(sugestaoUtil.competencia)}. ` : ""}
              {sugestaoUtil.motivo ? `(${sugestaoUtil.motivo})` : ""}
            </Alerta>
          ) : null}

          {!escritorio ? (
            <Card>
              <CardHeader>
                <CardTitle>Dados lidos do arquivo</CardTitle>
              </CardHeader>
              <CardContent>
                <LeituraDocumento
                  status={doc.processamento_status}
                  detalhes={doc.processamento_detalhes as Record<string, unknown> | null}
                  extracao={doc.extracao as Record<string, unknown> | null}
                  empresaId={empresaId}
                  documentoId={doc.id}
                  podeImportar={ctx.pode("financeiro.importar")}
                />
                {revisor ? (
                  <div className="mt-4">
                    <BotaoAcao tamanho="sm" variante="fantasma" acao={reprocessarDocumento.bind(null, empresaId, doc.id)}>
                      Ler o arquivo novamente
                    </BotaoAcao>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {filhos.data ? (
            <Card>
              <CardHeader>
                <CardTitle>Arquivos extraídos do ZIP ({filhos.count ?? 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {filhos.data.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {filhos.data.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                        <Link href={`${base}/${f.id}`} className="truncate hover:underline">
                          {f.nome_original}
                        </Link>
                        {f.status ? <Badge variante={STATUS_DOCUMENTO[f.status]?.tom ?? "neutro"}>{STATUS_DOCUMENTO[f.status]?.rotulo ?? f.status}</Badge> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum arquivo extraído ainda.</p>
                )}
                {(filhos.count ?? 0) > 100 ? <p className="mt-2 text-xs text-muted-foreground">Mostrando os 100 primeiros.</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Versões do arquivo</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <tr>
                    <Th>Versão</Th>
                    <Th>Arquivo</Th>
                    <Th>Enviado</Th>
                    <Th>Verificação</Th>
                    <Th className="w-10">
                      <span className="sr-only">Baixar</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {(versoes.data ?? []).map((v) => (
                    <Tr key={v.id}>
                      <Td>
                        v{v.versao}
                        {v.versao === doc.versao_atual ? <span className="ml-1 text-xs text-muted-foreground">(atual)</span> : null}
                      </Td>
                      <Td className="max-w-[16rem]">
                        <span className="block truncate" title={v.nome_original}>
                          {v.nome_original}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatarTamanho(v.tamanho)}
                          {v.motivo ? ` · ${v.motivo}` : ""}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        {v.upload_concluido_em ? formatarDataHora(v.upload_concluido_em) : "Envio não concluído"}
                        <span className="block text-xs text-muted-foreground">{(v.autor as Nome)?.nome ?? ""}</span>
                      </Td>
                      <Td>
                        <Badge variante={VERIFICACAO[v.verificacao_status]?.tom ?? "neutro"}>{VERIFICACAO[v.verificacao_status]?.rotulo ?? v.verificacao_status}</Badge>
                      </Td>
                      <Td>
                        {podeBaixar && v.upload_concluido_em && (v.verificacao_status !== "bloqueado" || revisor) ? (
                          <Button asChild variante="fantasma" tamanho="iconeSm" aria-label={`Baixar versão ${v.versao}`}>
                            <a href={`/api/documentos/${doc.id}/arquivo?modo=baixar&versao=${v.versao}`}>
                              <Download />
                            </a>
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {(historico.data ?? []).map((h) => (
                  <li key={h.id} className="border-l-2 border-bege-forte pl-3 text-sm">
                    <p className="font-medium">
                      {ACAO_HISTORICO_DOCUMENTO[h.acao] ?? h.acao}
                      {h.acao === "status" && h.status_novo ? `: ${STATUS_DOCUMENTO[h.status_novo]?.rotulo ?? h.status_novo}` : ""}
                    </p>
                    {h.motivo ? <p className="text-muted-foreground">{h.motivo}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {formatarDataHora(h.alterado_em)}
                      {(h.autor as Nome)?.nome ? ` · ${(h.autor as Nome)!.nome}` : " · sistema"}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acessos recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {acessos.data?.length ? (
                <ul className="space-y-1 text-sm">
                  {acessos.data.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {a.tipo === "visualizacao" ? "Visualizado" : a.tipo === "download_lote" ? "Baixado (em lote)" : "Baixado"} por {(a.usuario as Nome)?.nome ?? "usuário removido"}
                        {a.versao ? ` · v${a.versao}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatarDataHora(a.ocorrido_em)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Ninguém abriu este arquivo ainda.</p>
              )}
              {escritorio ? (
                <p className="mt-3 text-xs text-muted-foreground">A visualização ou o download registram apenas o acesso ao arquivo; não comprovam pagamento.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          {!escritorio && revisor && !doc.excluido_em ? (
            <Card>
              <CardHeader>
                <CardTitle>Conferência do escritório</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <AcoesConferencia empresaId={empresaId} documentoId={doc.id} status={doc.status ?? "recebido"} />
                <p className="text-xs text-muted-foreground">A aprovação é uma conferência interna e não representa validação fiscal.</p>
                {doc.status_alterado_em ? (
                  <p className="text-xs text-muted-foreground">
                    Última alteração: {formatarDataHora(doc.status_alterado_em)}
                    {(doc.conferente as Nome)?.nome ? ` por ${(doc.conferente as Nome)!.nome}` : ""}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {doc.recebido_apos_fechamento ? (
            <Card>
              <CardHeader>
                <CardTitle>Recebido após o fechamento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {doc.apos_fechamento_avaliado_em ? (
                  <>
                    <p>{doc.apos_fechamento_parecer}</p>
                    <p className="text-xs text-muted-foreground">Avaliado em {formatarDataHora(doc.apos_fechamento_avaliado_em)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">A competência já estava fechada quando o documento chegou. A equipe avalia se ele altera os números publicados.</p>
                    {ctx.pode("fechamento.gerenciar") ? <AvaliarAposFechamento empresaId={empresaId} documentoId={doc.id} /> : null}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Informações</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Protocolo de recebimento</dt>
                  <dd className="numero">{protocolo(doc.id, doc.enviado_em)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{escritorio ? "Publicado em" : "Recebido em"}</dt>
                  <dd>
                    {formatarDataHora(doc.enviado_em)}
                    {(doc.autor as Nome)?.nome ? ` por ${(doc.autor as Nome)!.nome}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Competência</dt>
                  <dd>{formatarCompetencia(doc.competencia, true)}</dd>
                </div>
                {item ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Pendência atendida</dt>
                    <dd>
                      <Link className="underline-offset-2 hover:underline" href={`/e/${empresaId}/pendencias?competencia=${doc.competencia.slice(0, 7)}`}>
                        {item.titulo}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {escritorio && doc.vencimento ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Vencimento</dt>
                    <dd>{formatarData(doc.vencimento)}</dd>
                  </div>
                ) : null}
                {escritorio && doc.valor != null ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Valor</dt>
                    <dd>{formatarMoeda(doc.valor)}</dd>
                  </div>
                ) : null}
                {doc.observacao ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Observação</dt>
                    <dd className="whitespace-pre-wrap">{doc.observacao}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">Origem</dt>
                  <dd>{ORIGEM_DOCUMENTO[doc.origem] ?? doc.origem}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Arquivo</dt>
                  <dd className="break-all">
                    {doc.nome_original} · {formatarTamanho(doc.tamanho)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Verificação de segurança</dt>
                  <dd>
                    <Badge variante={ver?.tom ?? "neutro"}>{ver?.rotulo ?? doc.verificacao_status}</Badge>
                    {doc.verificacao_detalhes ? <span className="mt-1 block text-xs text-muted-foreground">{doc.verificacao_detalhes}</span> : null}
                  </dd>
                </div>
                {revisor && doc.sha256 ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">SHA-256</dt>
                    <dd className="numero break-all text-xs">{doc.sha256}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {!doc.excluido_em && (podeEditar || podeExcluir) ? (
            <div className="flex flex-wrap gap-2">
              {podeEditar ? (
                <>
                  <ReclassificarDocumento
                    empresaId={empresaId}
                    documentoId={doc.id}
                    escritorio={escritorio}
                    categorias={cats.filter((c) => c.escritorio === escritorio && c.extensoes.includes(doc.extensao ?? ""))}
                    competencias={listaCompetencias(36, 1)}
                    itens={itens.data ?? []}
                    valores={{
                      categoria: doc.categoria_codigo,
                      competencia: doc.competencia,
                      item: doc.checklist_item_id,
                      observacao: doc.observacao,
                      titulo: doc.titulo,
                      vencimento: doc.vencimento,
                      valor: doc.valor != null ? String(doc.valor).replace(".", ",") : null,
                    }}
                  />
                  <SubstituirArquivo
                    empresaId={empresaId}
                    documentoId={doc.id}
                    extensoes={categoria?.extensoes ?? []}
                    limiteMb={escritorioCfg.data?.upload_tamanho_maximo_mb ?? 50}
                  />
                </>
              ) : null}
              {podeExcluir ? <ExcluirDocumento empresaId={empresaId} documentoId={doc.id} destino={base} /> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
