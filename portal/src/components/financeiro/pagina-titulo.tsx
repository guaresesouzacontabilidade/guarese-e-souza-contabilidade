import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CopyPlus, ExternalLink, FileText, History, Pencil, UserRound } from "lucide-react";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormularioLancamento } from "@/components/financeiro/formulario-lancamento";
import { AcoesLancamento, BotaoDesvincular, BotaoEstornar, RegistrarBaixa, VincularDocumento } from "@/components/financeiro/acoes-lancamento";
import { AlterarRecorrencia, BotaoDesfazerRenegociacao, BotoesAprovacao } from "@/components/financeiro/acoes-titulo";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { APROVACAO_PAGAMENTO, ORIGEM_LANCAMENTO, SITUACAO_LANCAMENTO, TIPOS_CATEGORIA } from "@/lib/rotulos";
import { parametro } from "@/lib/busca";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;
type Nome = { nome: string } | null;
type Sp = Record<string, string | string[] | undefined>;

const FORMAS: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transferencia: "Transferência",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  debito_automatico: "Débito automático",
  outro: "Outro",
};

const FREQ: Record<string, string> = {
  semanal: "semanal",
  quinzenal: "quinzenal",
  mensal: "mensal",
  bimestral: "bimestral",
  trimestral: "trimestral",
  semestral: "semestral",
  anual: "anual",
};

type Evento = { quando: string; texto: string; quem?: string | null; tom?: "perigo" | "sucesso" | "alerta" };

/**
 * Um título (conta a pagar ou a receber): valor original, quanto já foi pago e
 * o saldo em destaque; pagamentos e estornos (com o motivo); aprovação;
 * renegociação; recorrência; de onde veio (abre o documento que o criou) e o
 * histórico completo.
 */
export async function PaginaTitulo({ ctx, empresaId, lancamentoId, tipoRota, sp }: { ctx: ContextoEmpresa; empresaId: string; lancamentoId: string; tipoRota: "pagar" | "receber" | null; sp: Sp }) {
  if (!UUID.test(lancamentoId)) notFound();
  const hoje = hojeISO();
  const podeEditar = ctx.pode("financeiro.editar");

  const { data: l } = await ctx.supabase
    .from("lancamentos")
    .select(
      "*, categoria:categorias_financeiras(nome, codigo, tipo), contraparte:contrapartes(id, nome, documento), conta:contas_financeiras(nome, tipo), centro:centros_custo(nome), projeto:projetos(nome), autor:perfis!lancamentos_criado_por_fkey(nome), confirmador:perfis!lancamentos_confirmado_por_fkey(nome), cancelador:perfis!lancamentos_cancelado_por_fkey(nome)",
    )
    .eq("id", lancamentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!l) notFound();
  const tipo = l.tipo as "pagar" | "receber";
  const voltarConsulta = parametro(sp, "voltar");
  // Endereço antigo ou do outro tipo: vai para o certo (mantendo a volta para a lista)
  if (tipoRota !== tipo) {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
    redirect(`/e/${empresaId}/financeiro/${tipo}/${lancamentoId}${q ? `?${q}` : ""}`);
  }
  const base = `/e/${empresaId}/financeiro/${tipo}`;
  const pagar = tipo === "pagar";

  const [baixas, estornadas, aprovacoes, vinculos, parcelas, contas, docs, fiscal, renegOrigem, renegAcordo, recorrencia, venda] = await Promise.all([
    ctx.supabase
      .from("baixas")
      .select("id, data_pagamento, valor_principal, juros, multa, desconto, taxas, valor_total, forma_pagamento, origem, conciliacao_id, observacao, created_at, conta:contas_financeiras(nome), autor:perfis!baixas_criado_por_fkey(nome)")
      .eq("lancamento_id", lancamentoId)
      .order("data_pagamento"),
    ctx.supabase
      .from("baixas_estornadas")
      .select("id, data_pagamento, valor_principal, valor_total, forma_pagamento, motivo_estorno, estornado_em, criado_em, conta:contas_financeiras(nome), estornador:perfis!baixas_estornadas_estornado_por_fkey(nome)")
      .eq("lancamento_id", lancamentoId)
      .order("estornado_em"),
    ctx.supabase
      .from("lancamento_aprovacoes")
      .select("id, decisao, justificativa, valor, created_at, quem:perfis!lancamento_aprovacoes_decidido_por_fkey(nome)")
      .eq("lancamento_id", lancamentoId)
      .order("created_at"),
    ctx.supabase.from("lancamento_documentos").select("documento_id, tipo_vinculo, documento:documentos(nome_original, titulo)").eq("lancamento_id", lancamentoId),
    l.parcelamento_id
      ? ctx.supabase.from("lancamentos").select("id, parcela_numero, parcela_total, data_vencimento, situacao").eq("parcelamento_id", l.parcelamento_id).order("parcela_numero")
      : Promise.resolve({ data: null }),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.pode("documentos.ver")
      ? ctx.supabase.from("documentos").select("id, nome_original, titulo, competencia").eq("empresa_id", empresaId).eq("upload_status", "concluido").is("excluido_em", null).order("enviado_em", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    l.documento_fiscal_id ? ctx.supabase.from("documentos_fiscais").select("id, tipo_documento, numero, documento_id").eq("id", l.documento_fiscal_id).maybeSingle() : Promise.resolve({ data: null }),
    // Título original renegociado → o acordo e as parcelas novas
    l.renegociado_em_id
      ? ctx.supabase.from("renegociacoes").select("id, numero, motivo, valor_renegociado, valor_novo, encargos, created_at, desfeita_em, quem:perfis!renegociacoes_criado_por_fkey(nome)").eq("id", l.renegociado_em_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Parcela de um acordo → o acordo e os títulos originais
    l.renegociacao_id
      ? ctx.supabase.from("renegociacoes").select("id, numero, motivo, valor_renegociado, valor_novo, encargos, created_at, desfeita_em, quem:perfis!renegociacoes_criado_por_fkey(nome)").eq("id", l.renegociacao_id).maybeSingle()
      : Promise.resolve({ data: null }),
    l.recorrencia_id ? ctx.supabase.from("recorrencias").select("frequencia, dia_vencimento, ativa, data_fim").eq("id", l.recorrencia_id).maybeSingle() : Promise.resolve({ data: null }),
    l.origem === "venda" ? ctx.supabase.from("venda_pagamentos").select("venda_id").contains("lancamentos", [lancamentoId]).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const acordo = renegOrigem.data ?? renegAcordo.data;
  const { data: ligados } = acordo
    ? await ctx.supabase
        .from("lancamentos")
        .select("id, descricao, data_vencimento, valor_previsto, valor_baixado, situacao")
        .eq("empresa_id", empresaId)
        .eq(renegOrigem.data ? "renegociacao_id" : "renegociado_em_id", acordo.id)
        .order("data_vencimento")
    : { data: null };

  const editar = podeEditar && parametro(sp, "editar") === "1" && !["cancelado", "renegociado"].includes(l.situacao);
  const categoria = l.categoria as { nome: string; codigo: string; tipo: string } | null;
  const contraparte = l.contraparte as { id: string; nome: string; documento: string | null } | null;
  const fora = l.fora_do_resultado || (categoria ? !TIPOS_CATEGORIA[categoria.tipo]?.dre : false);
  const emAberto = ["aberto", "parcial"].includes(l.situacao);
  const saldo = dec(l.valor_previsto).minus(dec(l.valor_baixado));
  const vencido = emAberto && l.data_vencimento < hoje;
  const diasAtraso = vencido ? Math.round((Date.parse(hoje) - Date.parse(l.data_vencimento)) / 86_400_000) : 0;
  const st = SITUACAO_LANCAMENTO[l.situacao];
  const ap = l.aprovacao_status !== "nao_exige" ? APROVACAO_PAGAMENTO[l.aprovacao_status] : null;
  const listaBaixas = baixas.data ?? [];
  const vinculados = new Set((vinculos.data ?? []).map((v) => v.documento_id));
  const voltarHref = voltarConsulta ? `${base}?${voltarConsulta}` : base;
  const contrapartesHref = contraparte ? `${base}/contraparte/${contraparte.id}` : null;

  // De onde veio: o documento ou a tela que criou o título
  const origem: { rotulo: string; href: string } | null = (() => {
    const ref = l.origem_referencia && UUID.test(l.origem_referencia) ? l.origem_referencia : null;
    if (venda.data?.venda_id) return { rotulo: "Abrir a venda", href: `/e/${empresaId}/loja/vendas/${venda.data.venda_id}` };
    if (fiscal.data?.documento_id) return { rotulo: `Abrir ${fiscal.data.tipo_documento} nº ${fiscal.data.numero}`, href: `/e/${empresaId}/documentos/${fiscal.data.documento_id}` };
    if (l.origem === "os" && ref) return { rotulo: "Abrir a ordem de serviço", href: `/e/${empresaId}/os/${ref}` };
    if (l.origem === "hotel" && ref) return { rotulo: "Abrir a reserva", href: `/e/${empresaId}/hotel/reservas/${ref}` };
    if (l.origem === "fisioterapia" && ref) return { rotulo: "Abrir o paciente", href: `/e/${empresaId}/fisioterapia/pacientes/${ref}` };
    if (l.origem === "veterinaria") return { rotulo: "Abrir as contas da clínica", href: `/e/${empresaId}/veterinaria/contas` };
    if (l.origem === "recorrencia") return { rotulo: "Ver as recorrências", href: `/e/${empresaId}/financeiro/configuracoes?aba=recorrencias` };
    if (l.origem === "conciliacao") return { rotulo: "Abrir a conciliação", href: `/e/${empresaId}/conciliacao` };
    if (l.origem === "importacao") return { rotulo: "Abrir as importações", href: `/e/${empresaId}/financeiro/importar` };
    return null;
  })();

  // Histórico do título (quem fez o quê e quando)
  const eventos: Evento[] = [
    { quando: l.created_at, texto: `Título criado (${ORIGEM_LANCAMENTO[l.origem] ?? l.origem}) com valor de ${formatarMoeda(l.valor_previsto)}`, quem: (l.autor as Nome)?.nome },
    ...(l.confirmado_em && l.origem !== "manual" ? [{ quando: l.confirmado_em, texto: "Conferido e confirmado", quem: (l.confirmador as Nome)?.nome }] : []),
    ...(aprovacoes.data ?? []).map((a) => ({
      quando: a.created_at,
      texto: `${a.decisao === "aprovado" ? "Pagamento aprovado" : "Pagamento reprovado"} (${formatarMoeda(a.valor)})${a.justificativa ? ` — ${a.justificativa}` : ""}`,
      quem: (a.quem as Nome)?.nome,
      tom: a.decisao === "aprovado" ? ("sucesso" as const) : ("perigo" as const),
    })),
    ...listaBaixas.map((b) => ({
      quando: b.created_at,
      texto: `${pagar ? "Pagamento" : "Recebimento"} de ${formatarMoeda(b.valor_total)} em ${formatarData(b.data_pagamento)} (${(b.conta as Nome)?.nome ?? "conta"})`,
      quem: (b.autor as Nome)?.nome,
      tom: "sucesso" as const,
    })),
    ...(estornadas.data ?? []).map((e) => ({
      quando: e.estornado_em,
      texto: `Estorno de ${formatarMoeda(e.valor_total)} (pago em ${formatarData(e.data_pagamento)}) — ${e.motivo_estorno}`,
      quem: (e.estornador as Nome)?.nome,
      tom: "alerta" as const,
    })),
    ...(acordo ? [{ quando: acordo.created_at, texto: `Renegociação nº ${acordo.numero}: ${acordo.motivo}`, quem: (acordo.quem as Nome)?.nome }] : []),
    ...(acordo?.desfeita_em ? [{ quando: acordo.desfeita_em, texto: `Renegociação nº ${acordo.numero} desfeita`, tom: "alerta" as const }] : []),
    ...(l.cancelado_em ? [{ quando: l.cancelado_em, texto: `Cancelado — ${l.motivo_cancelamento ?? ""}`, quem: (l.cancelador as Nome)?.nome, tom: "perigo" as const }] : []),
  ].sort((a, b) => a.quando.localeCompare(b.quando));

  if (editar) {
    return (
      <>
        <CabecalhoPagina voltar={{ href: `${base}/${lancamentoId}${voltarConsulta ? `?voltar=${encodeURIComponent(voltarConsulta)}` : ""}`, rotulo: "Voltar ao título" }} titulo="Editar título" />
        {dec(l.valor_baixado).gt(0) ? <Alerta tom="info" className="mb-4">Este título tem pagamentos registrados: o valor não pode ficar menor que o total já pago.</Alerta> : null}
        {l.recorrencia_id ? (
          <Alerta tom="info" className="mb-4">
            Este título é de uma recorrência: aqui você muda só esta ocorrência. Para mudar também as próximas, use “Alterar recorrência” no título.
          </Alerta>
        ) : null}
        <Card>
          <CardContent className="pt-5">
            <FormularioLancamento
              empresaId={empresaId}
              opcoes={await carregarOpcoes(ctx, empresaId)}
              base={base}
              valores={{
                id: l.id,
                tipo,
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
        voltar={{ href: voltarHref, rotulo: pagar ? "Contas a pagar" : "Contas a receber" }}
        titulo={l.descricao}
        descricao={`${pagar ? "Conta a pagar" : "Conta a receber"}${contraparte ? ` · ${contraparte.nome}` : ""} · vence em ${formatarData(l.data_vencimento)}`}
        acoes={
          podeEditar ? (
            <>
              {l.categoria_id ? (
                <Button asChild variante="contorno">
                  <Link href={`${base}/novo?copiar=${lancamentoId}`}>
                    <CopyPlus /> Lançar de novo
                  </Link>
                </Button>
              ) : null}
              {!["cancelado", "renegociado"].includes(l.situacao) ? (
                <Button asChild variante="contorno">
                  <Link href={`${base}/${lancamentoId}?editar=1${voltarConsulta ? `&voltar=${encodeURIComponent(voltarConsulta)}` : ""}`}>
                    <Pencil /> Editar
                  </Link>
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" data-testid="situacao-titulo">
        <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? l.situacao}</Badge>
        {vencido ? <Badge variante="perigo">Vencido há {diasAtraso} dia(s)</Badge> : null}
        {ap && emAberto ? <Badge variante={ap.tom}>{ap.rotulo}</Badge> : null}
        {l.status_revisao === "sugerido" ? <Badge variante="alerta">A conferir — fora dos relatórios até confirmar</Badge> : null}
        {l.renegociacao_id ? <Badge variante="info">Parcela de acordo</Badge> : null}
        {fora ? <Badge variante="info">Fora do resultado (não entra na DRE)</Badge> : null}
      </div>
      {l.situacao === "cancelado" ? (
        <Alerta tom="alerta" className="mb-4" titulo={`Cancelado em ${formatarDataHora(l.cancelado_em)}`}>
          {l.motivo_cancelamento}
        </Alerta>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          {/* Valor original, liquidado e saldo em destaque */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="valores-titulo">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Valor original</p>
              <p className="text-lg font-semibold numero">{formatarMoeda(l.valor_previsto)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{pagar ? "Total pago" : "Total recebido"}</p>
              <p className="text-lg font-semibold text-sucesso numero">{formatarMoeda(l.valor_baixado)}</p>
            </div>
            <div className={cn("col-span-2 rounded-xl border p-3 sm:col-span-1", vencido ? "border-perigo/40 bg-perigo-bg" : "border-primary/30 bg-primary/5")}>
              <p className="text-xs text-muted-foreground">Saldo em aberto</p>
              <p className={cn("text-2xl font-bold numero", vencido ? "text-perigo" : "")} data-testid="saldo-titulo">
                {emAberto ? formatarMoeda(saldo) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Movimentado na conta</p>
              <p className="font-semibold numero">{formatarMoeda(l.valor_realizado)}</p>
              <p className="text-[11px] text-muted-foreground">com juros, multa, desconto e taxas</p>
            </div>
          </div>

          {/* Aprovação */}
          {pagar && l.aprovacao_status !== "nao_exige" ? (
            <Card>
              <CardHeader>
                <CardTitle>Aprovação do pagamento</CardTitle>
                <CardDescription>
                  {l.aprovacao_status === "pendente"
                    ? `Aguardando ${l.aprovacoes_necessarias} aprovação(ões). Enquanto isso, o pagamento não pode ser baixado.`
                    : l.aprovacao_status === "aprovado"
                      ? "Aprovado: já pode ser pago."
                      : "Reprovado: não pode ser pago. Se o valor mudar, volta a pedir aprovação."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {aprovacoes.data?.length ? (
                  <ul className="space-y-1 text-sm">
                    {aprovacoes.data.map((a) => (
                      <li key={a.id}>
                        <Badge variante={a.decisao === "aprovado" ? "sucesso" : "perigo"}>{a.decisao === "aprovado" ? "Aprovou" : "Reprovou"}</Badge>{" "}
                        {(a.quem as Nome)?.nome ?? "—"} · {formatarDataHora(a.created_at)} · {formatarMoeda(a.valor)}
                        {a.justificativa ? <span className="block text-xs text-muted-foreground">{a.justificativa}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {ctx.pode("financeiro.aprovar") && emAberto && l.aprovacao_status !== "aprovado" ? (
                  l.criado_por && l.criado_por === ctx.sessao.usuarioId ? (
                    <p className="text-sm text-muted-foreground">Você lançou este pagamento: a aprovação precisa ser de outra pessoa com a permissão “Aprovar pagamentos”.</p>
                  ) : (
                    <BotoesAprovacao empresaId={empresaId} lancamentoId={l.id} />
                  )
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Pagamentos / recebimentos */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{pagar ? "Pagamentos" : "Recebimentos"}</CardTitle>
              {ctx.pode("financeiro.baixar") && l.status_revisao === "confirmado" && emAberto && !(pagar && ["pendente", "reprovado"].includes(l.aprovacao_status)) ? (
                <RegistrarBaixa
                  empresaId={empresaId}
                  lancamentoId={l.id}
                  tipo={tipo}
                  aberto={saldo.toFixed(2)}
                  contas={(contas.data ?? []).filter((c) => c.tipo !== "adquirente" || !pagar)}
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
                        <Td className="max-w-[16rem] text-sm">
                          {formatarData(b.data_pagamento)}
                          <span className="block truncate text-xs text-muted-foreground" title={(b.conta as Nome)?.nome}>
                            {[(b.conta as Nome)?.nome, b.forma_pagamento ? FORMAS[b.forma_pagamento] : null, b.conciliacao_id ? "conciliado com o extrato" : null, (b.autor as Nome)?.nome ? `por ${(b.autor as Nome)!.nome}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {b.observacao ? <span className="block text-xs text-muted-foreground">{b.observacao}</span> : null}
                        </Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.valor_principal)}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(dec(b.juros).plus(dec(b.multa)))}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.desconto)}</Td>
                        <Td className="whitespace-nowrap text-right numero">{formatarMoeda(b.taxas)}</Td>
                        <Td className="whitespace-nowrap text-right font-medium numero">{formatarMoeda(b.valor_total)}</Td>
                        <Td>{ctx.pode("financeiro.estornar") && !b.conciliacao_id && ["manual", "importacao"].includes(b.origem) && l.situacao !== "renegociado" ? <BotaoEstornar empresaId={empresaId} baixaId={b.id} /> : null}</Td>
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
                  {l.status_revisao === "sugerido"
                    ? "Confirme o título para registrar pagamentos."
                    : pagar && l.aprovacao_status === "pendente"
                      ? "O pagamento poderá ser registrado depois da aprovação."
                      : `Nenhum ${pagar ? "pagamento" : "recebimento"} registrado ainda.`}
                </p>
              )}
              {estornadas.data?.length ? (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estornados (histórico)</p>
                  <ul className="space-y-1 text-sm" data-testid="estornos">
                    {estornadas.data.map((e) => (
                      <li key={e.id} className="rounded-lg bg-muted/50 px-3 py-2">
                        <span className="line-through">
                          {formatarMoeda(e.valor_total)} em {formatarData(e.data_pagamento)} · {(e.conta as Nome)?.nome}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Estornado em {formatarDataHora(e.estornado_em)}
                          {(e.estornador as Nome)?.nome ? ` por ${(e.estornador as Nome)!.nome}` : ""} — {e.motivo_estorno}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">Juros e multas pagos ou recebidos ficam separados do principal e entram no resultado financeiro; descontos e taxas também.</p>
            </CardContent>
          </Card>

          {/* Renegociação */}
          {acordo ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>{renegOrigem.data ? `Renegociado no acordo nº ${acordo.numero}` : `Parcela do acordo nº ${acordo.numero}`}</CardTitle>
                  <CardDescription>
                    {acordo.motivo} · antes {formatarMoeda(acordo.valor_renegociado)}, acordo {formatarMoeda(acordo.valor_novo)}
                    {dec(acordo.encargos).isZero() ? "" : dec(acordo.encargos).gt(0) ? ` (juros/encargos de ${formatarMoeda(acordo.encargos)})` : ` (desconto de ${formatarMoeda(dec(acordo.encargos).abs())})`}
                    {acordo.desfeita_em ? " · desfeito" : ""}
                  </CardDescription>
                </div>
                {podeEditar && !acordo.desfeita_em ? <BotaoDesfazerRenegociacao empresaId={empresaId} renegociacaoId={acordo.id} numero={acordo.numero} /> : null}
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">{renegOrigem.data ? "Parcelas do acordo (as que valem agora):" : "Títulos originais (ficam no histórico, sem contar de novo):"}</p>
                <ul className="divide-y divide-border text-sm">
                  {(ligados ?? []).map((x) => (
                    <li key={x.id} className="flex justify-between gap-2 py-1.5">
                      <Link href={`${base}/${x.id}`} className="truncate hover:underline">
                        {x.descricao} · {formatarData(x.data_vencimento)}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="numero">{formatarMoeda(x.valor_previsto)}</span>
                        <Badge variante={SITUACAO_LANCAMENTO[x.situacao]?.tom ?? "neutro"}>{SITUACAO_LANCAMENTO[x.situacao]?.rotulo ?? x.situacao}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {ctx.pode("documentos.ver") ? (
            <Card>
              <CardHeader>
                <CardTitle>Anexos e documentos</CardTitle>
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
                  <p className="text-sm text-muted-foreground">Nenhum anexo. Vincule a nota fiscal, o boleto ou o comprovante.</p>
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

          {/* Histórico */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Histórico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l border-border pl-4 text-sm" data-testid="historico-titulo">
                {eventos.map((e, i) => (
                  <li key={i} className="relative">
                    <span
                      className={cn(
                        "absolute -left-[21px] top-1.5 size-2.5 rounded-full",
                        e.tom === "perigo" ? "bg-perigo" : e.tom === "sucesso" ? "bg-sucesso" : e.tom === "alerta" ? "bg-alerta" : "bg-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span>{e.texto}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatarDataHora(e.quando)}
                      {e.quem ? ` · ${e.quem}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Detalhes</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{pagar ? "Fornecedor" : "Cliente"}</dt>
                  <dd>
                    {contraparte ? (
                      <Link href={contrapartesHref!} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <UserRound className="size-3.5" /> {contraparte.nome}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Categoria</dt>
                  <dd>{categoria ? `${categoria.codigo} ${categoria.nome}` : <span className="text-alerta-fg">Sem categoria — edite para definir</span>}</dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Emissão</dt>
                    <dd>{formatarData(l.created_at.slice(0, 10))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Competência</dt>
                    <dd>{formatarData(l.data_competencia)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Vencimento</dt>
                    <dd className={vencido ? "font-medium text-perigo" : undefined}>{formatarData(l.data_vencimento)}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Conta prevista</dt>
                  <dd>{(l.conta as Nome)?.nome ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Centro de custo / projeto</dt>
                  <dd>{[(l.centro as Nome)?.nome, (l.projeto as Nome)?.nome].filter(Boolean).join(" · ") || "—"}</dd>
                </div>
                {l.numero_documento ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Nº do documento</dt>
                    <dd>{l.numero_documento}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">Origem</dt>
                  <dd>
                    {ORIGEM_LANCAMENTO[l.origem] ?? l.origem}
                    {origem ? (
                      <Link href={origem.href} className="ml-1 inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="size-3.5" /> {origem.rotulo}
                      </Link>
                    ) : null}
                  </dd>
                </div>
                {l.observacoes ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Observações</dt>
                    <dd className="whitespace-pre-wrap">{l.observacoes}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {recorrencia.data ? (
            <Card>
              <CardHeader>
                <CardTitle>Recorrência</CardTitle>
                <CardDescription>
                  Lançamento {FREQ[recorrencia.data.frequencia] ?? recorrencia.data.frequencia}
                  {recorrencia.data.dia_vencimento ? `, todo dia ${recorrencia.data.dia_vencimento}` : ""}
                  {recorrencia.data.data_fim ? ` até ${formatarData(recorrencia.data.data_fim)}` : ""}.
                </CardDescription>
              </CardHeader>
              {podeEditar && emAberto && dec(l.valor_baixado).isZero() ? (
                <CardContent>
                  <AlterarRecorrencia
                    empresaId={empresaId}
                    lancamentoId={l.id}
                    descricao={l.descricao}
                    valor={dec(l.valor_previsto).toFixed(2)}
                    vencimento={l.data_vencimento}
                    frequencia={FREQ[recorrencia.data.frequencia] ?? recorrencia.data.frequencia}
                  />
                </CardContent>
              ) : null}
            </Card>
          ) : null}

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

          {podeEditar && l.situacao !== "renegociado" && !l.renegociacao_id ? (
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
