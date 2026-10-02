import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormularioLancamento } from "@/components/financeiro/formulario-lancamento";
import { AcoesLancamento, BotaoDesvincular, BotaoEstornar, RegistrarBaixa, VincularDocumento } from "@/components/financeiro/acoes-lancamento";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { ORIGEM_LANCAMENTO, SITUACAO_LANCAMENTO, TIPOS_CATEGORIA } from "@/lib/rotulos";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Lançamento" };
const UUID = /^[0-9a-f-]{36}$/i;
type Nome = { nome: string } | null;

const FORMAS: Record<string, string> = {
  pix: "PIX",
  boleto: "Boleto",
  transferencia: "Transferência",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  debito_automatico: "Débito automático",
  outro: "Outro",
};

export default async function PaginaLancamento({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos/[lancamentoId]">) {
  const { empresaId, lancamentoId } = await params;
  const sp = await searchParams;
  if (!UUID.test(lancamentoId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  const base = `/e/${empresaId}/financeiro/lancamentos`;
  const hoje = hojeISO();
  const podeEditar = ctx.pode("financeiro.editar");

  const { data: l } = await ctx.supabase
    .from("lancamentos")
    .select(
      "*, categoria:categorias_financeiras(nome, codigo, tipo), contraparte:contrapartes(nome, documento), conta:contas_financeiras(nome, tipo), centro:centros_custo(nome), projeto:projetos(nome), autor:perfis!lancamentos_criado_por_fkey(nome), confirmador:perfis!lancamentos_confirmado_por_fkey(nome)",
    )
    .eq("id", lancamentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!l) notFound();

  const [baixas, vinculos, parcelas, contas, docs, fiscal] = await Promise.all([
    ctx.supabase
      .from("baixas")
      .select("id, data_pagamento, valor_principal, juros, multa, desconto, taxas, valor_total, forma_pagamento, origem, conciliacao_id, observacao, conta:contas_financeiras(nome)")
      .eq("lancamento_id", lancamentoId)
      .order("data_pagamento"),
    ctx.supabase.from("lancamento_documentos").select("documento_id, tipo_vinculo, documento:documentos(nome_original, titulo)").eq("lancamento_id", lancamentoId),
    l.parcelamento_id
      ? ctx.supabase.from("lancamentos").select("id, parcela_numero, parcela_total, data_vencimento, situacao").eq("parcelamento_id", l.parcelamento_id).order("parcela_numero")
      : Promise.resolve({ data: null }),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.pode("documentos.ver")
      ? ctx.supabase
          .from("documentos")
          .select("id, nome_original, titulo, competencia")
          .eq("empresa_id", empresaId)
          .eq("upload_status", "concluido")
          .is("excluido_em", null)
          .order("enviado_em", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
    l.documento_fiscal_id ? ctx.supabase.from("documentos_fiscais").select("id, tipo_documento, numero, documento_id").eq("id", l.documento_fiscal_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const editar = podeEditar && parametro(sp, "editar") === "1" && l.situacao !== "cancelado";
  const categoria = l.categoria as { nome: string; codigo: string; tipo: string } | null;
  const fora = categoria ? !TIPOS_CATEGORIA[categoria.tipo]?.dre : false;
  const emAberto = dec(l.valor_previsto).minus(dec(l.valor_baixado));
  const atrasado = ["aberto", "parcial"].includes(l.situacao) && l.data_vencimento < hoje;
  const st = atrasado ? SITUACAO_LANCAMENTO.atrasado : SITUACAO_LANCAMENTO[l.situacao];
  const listaBaixas = baixas.data ?? [];
  const vinculados = new Set((vinculos.data ?? []).map((v) => v.documento_id));

  if (editar) {
    return (
      <>
        <CabecalhoPagina voltar={{ href: `${base}/${lancamentoId}`, rotulo: "Voltar ao lançamento" }} titulo="Editar lançamento" />
        {l.valor_baixado > 0 ? <Alerta tom="info" className="mb-4">Este lançamento tem pagamentos registrados: o valor não pode ficar menor que o total já pago.</Alerta> : null}
        <Card>
          <CardContent className="pt-5">
            <FormularioLancamento
              empresaId={empresaId}
              opcoes={await carregarOpcoes(ctx, empresaId)}
              base={base}
              valores={{
                id: l.id,
                tipo: l.tipo as "receber" | "pagar",
                descricao: l.descricao,
                categoria_id: l.categoria_id ?? "",
                contraparte_id: l.contraparte_id ?? "",
                centro_custo_id: l.centro_custo_id ?? "",
                projeto_id: l.projeto_id ?? "",
                conta_financeira_id: l.conta_financeira_id ?? "",
                data_competencia: l.data_competencia,
                data_vencimento: l.data_vencimento,
                valor: dec(l.valor_previsto).toFixed(2),
                numero_documento: l.numero_documento ?? "",
                observacoes: l.observacoes ?? "",
              }}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: base, rotulo: "Lançamentos" }}
        titulo={l.descricao}
        descricao={`${l.tipo === "receber" ? "Conta a receber" : "Conta a pagar"} · ${ORIGEM_LANCAMENTO[l.origem] ?? l.origem}`}
        acoes={
          podeEditar && l.situacao !== "cancelado" ? (
            <Button asChild variante="contorno">
              <Link href={`${base}/${lancamentoId}?editar=1`}>
                <Pencil /> Editar
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {l.status_revisao === "sugerido" ? <Badge variante="alerta">Sugerido — fora dos relatórios até confirmar</Badge> : null}
        <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? l.situacao}</Badge>
        {fora ? <Badge variante="info">Fora do resultado (não entra na DRE)</Badge> : null}
      </div>
      {l.situacao === "cancelado" ? (
        <Alerta tom="alerta" className="mb-4" titulo={`Cancelado em ${formatarDataHora(l.cancelado_em)}`}>
          {l.motivo_cancelamento}
        </Alerta>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Valor</p>
              <p className="font-semibold numero">{formatarMoeda(l.valor_previsto)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{l.tipo === "receber" ? "Recebido (principal)" : "Pago (principal)"}</p>
              <p className="font-semibold numero">{formatarMoeda(l.valor_baixado)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Em aberto</p>
              <p className={atrasado ? "font-semibold text-perigo numero" : "font-semibold numero"}>{l.situacao === "cancelado" ? "—" : formatarMoeda(emAberto)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Movimentado na conta</p>
              <p className="font-semibold numero">{formatarMoeda(l.valor_realizado)}</p>
            </div>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{l.tipo === "receber" ? "Recebimentos" : "Pagamentos"}</CardTitle>
              {podeEditar && l.status_revisao === "confirmado" && ["aberto", "parcial"].includes(l.situacao) ? (
                <RegistrarBaixa
                  empresaId={empresaId}
                  lancamentoId={l.id}
                  tipo={l.tipo as "receber" | "pagar"}
                  aberto={emAberto.toFixed(2)}
                  contas={(contas.data ?? []).filter((c) => c.tipo !== "adquirente" || l.tipo === "receber")}
                  hoje={hoje}
                />
              ) : null}
            </CardHeader>
            <CardContent>
              {listaBaixas.length ? (
                <Table>
                  <THead>
                    <tr>
                      <Th>Data e conta</Th>
                      <Th className="text-right">Principal</Th>
                      <Th className="text-right">Juros e multa</Th>
                      <Th className="text-right">Desconto</Th>
                      <Th className="text-right">Taxas</Th>
                      <Th className="text-right">Total</Th>
                      <Th className="w-10">
                        <span className="sr-only">Ações</span>
                      </Th>
                    </tr>
                  </THead>
                  <TBody>
                    {listaBaixas.map((b) => (
                      <Tr key={b.id}>
                        <Td className="max-w-[14rem] text-sm">
                          {formatarData(b.data_pagamento)}
                          <span className="block truncate text-xs text-muted-foreground" title={(b.conta as Nome)?.nome}>
                            {[(b.conta as Nome)?.nome, b.forma_pagamento ? FORMAS[b.forma_pagamento] : null, b.conciliacao_id ? "conciliado" : null].filter(Boolean).join(" · ")}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.valor_principal)}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(dec(b.juros).plus(dec(b.multa)))}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.desconto)}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.taxas)}</Td>
                        <Td className="whitespace-nowrap text-right font-medium numero">{formatarMoeda(b.valor_total)}</Td>
                        <Td>{podeEditar && !b.conciliacao_id ? <BotaoEstornar empresaId={empresaId} baixaId={b.id} /> : null}</Td>
                      </Tr>
                    ))}
                  </TBody>
                  <TFoot>
                    <tr>
                      <Td>Total</Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(somar(listaBaixas.map((b) => b.valor_principal)))}</Td>
                      <Td colSpan={3} />
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(somar(listaBaixas.map((b) => b.valor_total)))}</Td>
                      <Td />
                    </tr>
                  </TFoot>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {l.status_revisao === "sugerido" ? "Confirme o lançamento para registrar pagamentos." : "Nenhum pagamento registrado ainda."}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Juros e multas pagos ou recebidos são separados do principal e aparecem no resultado financeiro; descontos e taxas também.
              </p>
            </CardContent>
          </Card>

          {ctx.pode("documentos.ver") ? (
            <Card>
              <CardHeader>
                <CardTitle>Documentos vinculados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {vinculos.data?.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {vinculos.data.map((v) => {
                      const d = v.documento as { nome_original: string; titulo: string | null } | null;
                      return (
                        <li key={v.documento_id} className="flex items-center justify-between gap-2 py-2">
                          <Link href={`/e/${empresaId}/documentos/${v.documento_id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{d?.titulo ?? d?.nome_original}</span>
                          </Link>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variante="neutro">{v.tipo_vinculo.replace("_", " ")}</Badge>
                            {podeEditar ? <BotaoDesvincular empresaId={empresaId} lancamentoId={l.id} documentoId={v.documento_id} /> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum documento vinculado. Vincule a nota fiscal, o boleto ou o comprovante.</p>
                )}
                {podeEditar ? (
                  <VincularDocumento
                    empresaId={empresaId}
                    lancamentoId={l.id}
                    documentos={(docs.data ?? []).filter((d) => !vinculados.has(d.id)).map((d) => ({ id: d.id, nome: `${d.titulo ?? d.nome_original} (${d.competencia.slice(5, 7)}/${d.competencia.slice(0, 4)})` }))}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Detalhes</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Categoria</dt>
                  <dd>{categoria ? `${categoria.codigo} ${categoria.nome}` : <span className="text-alerta-fg">Sem categoria — edite para definir</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{l.tipo === "receber" ? "Cliente" : "Fornecedor"}</dt>
                  <dd>{(l.contraparte as Nome)?.nome ?? "—"}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Competência</dt>
                    <dd>{formatarData(l.data_competencia)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Vencimento</dt>
                    <dd className={atrasado ? "text-perigo" : undefined}>{formatarData(l.data_vencimento)}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Conta prevista</dt>
                  <dd>{(l.conta as Nome)?.nome ?? "—"}</dd>
                </div>
                {(l.centro as Nome)?.nome || (l.projeto as Nome)?.nome ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Centro de custo / projeto</dt>
                    <dd>{[(l.centro as Nome)?.nome, (l.projeto as Nome)?.nome].filter(Boolean).join(" · ")}</dd>
                  </div>
                ) : null}
                {l.numero_documento ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Nº do documento</dt>
                    <dd>{l.numero_documento}</dd>
                  </div>
                ) : null}
                {fiscal.data ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Origem fiscal</dt>
                    <dd>
                      <Link className="underline" href={`/e/${empresaId}/documentos/${fiscal.data.documento_id}`}>
                        {fiscal.data.tipo_documento} nº {fiscal.data.numero}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {l.observacoes ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Observações</dt>
                    <dd className="whitespace-pre-wrap">{l.observacoes}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">Registro</dt>
                  <dd className="text-xs text-muted-foreground">
                    Criado em {formatarDataHora(l.created_at)}
                    {(l.autor as Nome)?.nome ? ` por ${(l.autor as Nome)!.nome}` : ""}
                    {l.confirmado_em && l.origem !== "manual" ? ` · confirmado em ${formatarDataHora(l.confirmado_em)}${(l.confirmador as Nome)?.nome ? ` por ${(l.confirmador as Nome)!.nome}` : ""}` : ""}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {parcelas.data?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Parcelas</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {parcelas.data.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Link href={`${base}/${p.id}`} className={p.id === l.id ? "font-semibold" : "hover:underline"}>
                        {p.parcela_numero}/{p.parcela_total} · {formatarData(p.data_vencimento)}
                      </Link>
                      <Badge variante={SITUACAO_LANCAMENTO[p.situacao]?.tom ?? "neutro"}>{SITUACAO_LANCAMENTO[p.situacao]?.rotulo}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {podeEditar ? (
            <AcoesLancamento
              empresaId={empresaId}
              lancamentoId={l.id}
              situacao={l.situacao}
              revisao={l.status_revisao}
              temCategoria={Boolean(l.categoria_id)}
              temBaixas={listaBaixas.length > 0}
              base={base}
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}
