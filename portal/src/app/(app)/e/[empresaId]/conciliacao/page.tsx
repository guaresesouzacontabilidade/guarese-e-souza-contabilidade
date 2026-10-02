import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, FileUp, GitCompareArrows, Inbox, Landmark, Search, Sparkles } from "lucide-react";
import { obterContextoEmpresa, type ContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ListaSugestoes, type SugestaoVisual } from "@/components/conciliacao/sugestoes";
import { TabelaPendentes, type MovimentoPendente } from "@/components/conciliacao/pendentes";
import { ValorSinal } from "@/components/conciliacao/conciliar-manual";
import { BotaoBuscarSugestoes, BotaoReativar, DesfazerConciliacao, ExcluirSaldo, InformarSaldo } from "@/components/conciliacao/acoes-conciliacao";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { competenciaAtual, hojeISO, listaCompetencias, periodoDeParametros, somarDias, somarMeses } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { ROTULO_TRATAMENTO, type Tratamento } from "@/lib/conciliacao/tipos";

export const metadata: Metadata = { title: "Conciliação bancária" };

const ABAS = ["sugestoes", "pendentes", "conciliadas", "ignoradas", "saldos"] as const;
type Aba = (typeof ABAS)[number];
const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 100;
type Busca = Record<string, string | string[] | undefined>;

export default async function PaginaConciliacao({ params, searchParams }: PageProps<"/e/[empresaId]/conciliacao">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) return <Alerta tom="alerta">Seu acesso não inclui o financeiro desta empresa.</Alerta>;
  const podeExecutar = ctx.pode("conciliacao.executar");
  const conta = UUID.test(parametro(sp, "conta")) ? parametro(sp, "conta") : "";
  const desde30 = somarDias(hojeISO(), -30);

  const [contasR, nPend, nSug, nIgn, nConc30, ultimaImp, valoresPend] = await Promise.all([
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo, ativa").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("movimentos_bancarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("status_conciliacao", "pendente"),
    ctx.supabase.from("conciliacoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("status", "sugerida"),
    ctx.supabase.from("movimentos_bancarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("status_conciliacao", "ignorado"),
    ctx.supabase
      .from("conciliacoes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("status", "confirmada")
      .gte("confirmada_em", desde30),
    ctx.supabase
      .from("importacoes")
      .select("created_at, arquivo_nome")
      .eq("empresa_id", empresaId)
      .eq("status", "concluida")
      .in("tipo", ["extrato_ofx", "extrato_planilha"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    buscarTudo(
      (de, ate) => ctx.supabase.from("movimentos_bancarios").select("valor").eq("empresa_id", empresaId).eq("status_conciliacao", "pendente").range(de, ate),
      20000,
    ),
  ]);
  const contas = contasR.data ?? [];
  const totais = {
    pendentes: nPend.count ?? 0,
    sugestoes: nSug.count ?? 0,
    ignoradas: nIgn.count ?? 0,
    conciliadas30: nConc30.count ?? 0,
  };
  const entradas = somar(valoresPend.filter((v) => dec(v.valor).isPositive()).map((v) => v.valor));
  const saidas = somar(valoresPend.filter((v) => dec(v.valor).isNegative()).map((v) => dec(v.valor).abs()));
  const aba: Aba = (parametro(sp, "aba", ABAS) as Aba) || (totais.sugestoes > 0 ? "sugestoes" : "pendentes");
  const base = `/e/${empresaId}/conciliacao`;
  const hrefAba = (a: Aba) => urlCom(base, {}, { aba: a, conta: conta || null });
  const linkImportar = `/e/${empresaId}/financeiro/importar`;

  return (
    <>
      <CabecalhoPagina
        titulo="Conciliação bancária"
        descricao="Compare o extrato do banco com os lançamentos do sistema. Nenhuma conciliação acontece sem confirmação de uma pessoa."
        acoes={
          <>
            {podeExecutar ? <BotaoBuscarSugestoes empresaId={empresaId} /> : null}
            {ctx.pode("financeiro.importar") ? (
              <Button asChild>
                <Link href={linkImportar}>
                  <FileUp /> Importar extrato
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador
          rotulo="Pendentes"
          valor={totais.pendentes}
          tom={totais.pendentes ? "alerta" : "sucesso"}
          icone={Inbox}
          href={hrefAba("pendentes")}
          detalhe={
            totais.pendentes ? (
              <>
                Entradas <span className="numero">{formatarMoeda(entradas)}</span> · Saídas <span className="numero">{formatarMoeda(saidas)}</span>
              </>
            ) : (
              "Tudo conciliado"
            )
          }
        />
        <Indicador
          rotulo="Sugestões para revisar"
          valor={totais.sugestoes}
          tom={totais.sugestoes ? "info" : "neutro"}
          icone={Sparkles}
          href={hrefAba("sugestoes")}
          detalhe="Encontradas automaticamente"
        />
        <Indicador rotulo="Conciliadas (30 dias)" valor={totais.conciliadas30} icone={CircleCheck} tom="sucesso" href={hrefAba("conciliadas")} />
        <Indicador
          rotulo="Último extrato importado"
          valor={ultimaImp.data ? formatarRelativo(ultimaImp.data.created_at) : "Nenhum"}
          icone={Landmark}
          tom={ultimaImp.data ? "neutro" : "alerta"}
          detalhe={ultimaImp.data?.arquivo_nome ?? "Importe o OFX ou a planilha do banco"}
          href={ctx.pode("financeiro.importar") ? linkImportar : undefined}
        />
      </div>

      {!contas.length ? (
        <EstadoVazio
          icone={Landmark}
          titulo="Nenhuma conta bancária cadastrada"
          descricao="Cadastre as contas (banco, caixa, cartão, maquininha) para importar extratos e conciliar."
          acao={
            <Button asChild>
              <Link href={`/e/${empresaId}/financeiro/contas`}>Cadastrar contas</Link>
            </Button>
          }
        />
      ) : (
        <>
          <AbasLink
            ativa={aba}
            abas={[
              { valor: "sugestoes", rotulo: "Sugestões", href: hrefAba("sugestoes"), contador: totais.sugestoes },
              { valor: "pendentes", rotulo: "Pendentes", href: hrefAba("pendentes"), contador: totais.pendentes },
              { valor: "conciliadas", rotulo: "Conciliadas", href: hrefAba("conciliadas") },
              { valor: "ignoradas", rotulo: "Ignoradas", href: hrefAba("ignoradas"), contador: totais.ignoradas },
              { valor: "saldos", rotulo: "Conferência de saldos", href: hrefAba("saldos") },
            ]}
          />
          {aba === "sugestoes" ? <AbaSugestoes ctx={ctx} empresaId={empresaId} conta={conta} contas={contas} sp={sp} podeExecutar={podeExecutar} /> : null}
          {aba === "pendentes" ? <AbaPendentes ctx={ctx} empresaId={empresaId} conta={conta} contas={contas} sp={sp} podeExecutar={podeExecutar} /> : null}
          {aba === "conciliadas" ? <AbaConciliadas ctx={ctx} empresaId={empresaId} conta={conta} contas={contas} sp={sp} podeExecutar={podeExecutar} /> : null}
          {aba === "ignoradas" ? <AbaIgnoradas ctx={ctx} empresaId={empresaId} conta={conta} contas={contas} sp={sp} podeExecutar={podeExecutar} /> : null}
          {aba === "saldos" ? <AbaSaldos ctx={ctx} empresaId={empresaId} contas={contas} sp={sp} /> : null}
        </>
      )}
    </>
  );
}

interface PropsAba {
  ctx: ContextoEmpresa;
  empresaId: string;
  conta: string;
  contas: { id: string; nome: string; tipo: string; ativa: boolean }[];
  sp: Busca;
  podeExecutar: boolean;
}

function FiltroConta({ contas, conta, aba, extra }: { contas: PropsAba["contas"]; conta: string; aba: Aba; extra?: React.ReactNode }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
      <input type="hidden" name="aba" value={aba} />
      <Select name="conta" defaultValue={conta} aria-label="Conta" className="w-full sm:w-64">
        <option value="">Todas as contas</option>
        {contas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.ativa ? "" : " (inativa)"}
          </option>
        ))}
      </Select>
      {extra}
      <Button type="submit" variante="contorno">
        <Search /> Filtrar
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ sugestões
interface ItemBruto {
  movimento: { id: string; data: string; valor: number; descricao: string; conta_financeira_id: string } | null;
  lancamento: {
    id: string;
    tipo: string;
    descricao: string;
    data_vencimento: string;
    valor_previsto: number;
    valor_baixado: number;
    contraparte: { nome: string } | null;
  } | null;
  baixa: { id: string; data_pagamento: string; valor_total: number | null; lancamento: { descricao: string } | null } | null;
}

async function AbaSugestoes({ ctx, empresaId, conta, contas, podeExecutar }: PropsAba) {
  let q = ctx.supabase
    .from("conciliacoes")
    .select(
      "id, tipo, pontuacao, criterios, observacao, itens:conciliacao_itens(movimento:movimentos_bancarios(id, data, valor, descricao, conta_financeira_id), lancamento:lancamentos(id, tipo, descricao, data_vencimento, valor_previsto, valor_baixado, contraparte:contrapartes(nome)), baixa:baixas(id, data_pagamento, valor_total, lancamento:lancamentos(descricao)))",
    )
    .eq("empresa_id", empresaId)
    .eq("status", "sugerida");
  if (conta) q = q.eq("conta_financeira_id", conta);
  const { data, error } = await q.order("pontuacao", { ascending: false, nullsFirst: false }).order("created_at").limit(200);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as sugestões: {error.message}</Alerta>;
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const sugestoes: SugestaoVisual[] = ((data ?? []) as unknown as {
    id: string;
    tipo: string;
    pontuacao: number | null;
    criterios: Record<string, unknown> | null;
    observacao: string | null;
    itens: ItemBruto[];
  }[]).map((c) => {
    const movimentos = c.itens
      .flatMap((i) => (i.movimento ? [i.movimento] : []))
      .map((m) => ({ id: m.id, data: m.data, valor: dec(m.valor).toFixed(2), descricao: m.descricao, conta: nomeConta.get(m.conta_financeira_id) ?? "Conta" }));
    const lancamentos = c.itens
      .flatMap((i) => (i.lancamento ? [i.lancamento] : []))
      .map((l) => ({
        id: l.id,
        descricao: l.descricao,
        contraparte: l.contraparte?.nome ?? null,
        vencimento: l.data_vencimento,
        aberto: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
      }));
    const baixas = c.itens
      .flatMap((i) => (i.baixa ? [i.baixa] : []))
      .map((b) => ({ id: b.id, data: b.data_pagamento, total: dec(b.valor_total).toFixed(2), descricao: b.lancamento?.descricao ?? "Pagamento registrado" }));
    const totalMov = somar(movimentos.map((m) => dec(m.valor).abs()));
    const diferenca =
      c.tipo === "transferencia" ? dec(0) : totalMov.minus(somar([...lancamentos.map((l) => l.aberto), ...baixas.map((b) => b.total)]));
    return {
      id: c.id,
      tipo: c.tipo,
      pontuacao: c.pontuacao,
      criterios: c.criterios ?? {},
      observacao: c.observacao,
      sentido: movimentos[0] && dec(movimentos[0].valor).isNegative() ? "pagar" : "receber",
      movimentos,
      lancamentos,
      baixas,
      diferenca: diferenca.toFixed(2),
    };
  });

  return (
    <>
      <FiltroConta contas={contas} conta={conta} aba="sugestoes" />
      {sugestoes.length ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Confira cada par e confirme. Ao confirmar, o pagamento ou recebimento é registrado na data do extrato. Se algo estiver errado, rejeite: o
            par não será sugerido de novo.
          </p>
          <ListaSugestoes empresaId={empresaId} sugestoes={sugestoes} podeExecutar={podeExecutar} />
        </>
      ) : (
        <EstadoVazio
          icone={Sparkles}
          titulo="Nenhuma sugestão aguardando revisão"
          descricao="As sugestões aparecem depois de importar um extrato. Movimentações sem correspondência ficam na aba Pendentes."
          acao={podeExecutar ? <BotaoBuscarSugestoes empresaId={empresaId} /> : undefined}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ pendentes
async function AbaPendentes({ ctx, empresaId, conta, contas, sp, podeExecutar }: PropsAba) {
  const sentido = parametro(sp, "sentido", ["entradas", "saidas"]);
  const inicio = DATA.test(parametro(sp, "inicio")) ? parametro(sp, "inicio") : "";
  const fim = DATA.test(parametro(sp, "fim")) ? parametro(sp, "fim") : "";
  const busca = termoBusca(sp.busca);
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);

  let q = ctx.supabase
    .from("movimentos_bancarios")
    .select("id, data, valor, descricao, conta_financeira_id, documento_contraparte", { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("status_conciliacao", "pendente");
  if (conta) q = q.eq("conta_financeira_id", conta);
  if (sentido === "entradas") q = q.gt("valor", 0);
  if (sentido === "saidas") q = q.lt("valor", 0);
  if (inicio) q = q.gte("data", inicio);
  if (fim) q = q.lte("data", fim);
  if (busca) q = q.ilike("descricao", `%${busca}%`);
  const { data, count, error } = await q
    .order("data")
    .order("id")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as movimentações: {error.message}</Alerta>;
  const movs = data ?? [];
  const ids = movs.map((m) => m.id);
  const desde = somarMeses(competenciaAtual(), -3);
  const [emSugestao, opcoes, docs, catDocs] = await Promise.all([
    ids.length
      ? ctx.supabase.from("conciliacao_itens").select("movimento_id, conciliacoes!inner(status)").in("movimento_id", ids).eq("conciliacoes.status", "sugerida")
      : Promise.resolve({ data: [] as { movimento_id: string | null }[] }),
    podeExecutar ? carregarOpcoes(ctx, empresaId) : Promise.resolve(null),
    podeExecutar ? ctx.supabase.rpc("documentos_sem_vinculo", { p_empresa_id: empresaId, p_inicio: desde, p_fim: hojeISO() }).limit(200) : Promise.resolve({ data: [] }),
    ctx.supabase.from("categorias_documento").select("codigo, nome"),
  ]);
  const comSugestao = new Set((emSugestao.data ?? []).map((i) => i.movimento_id));
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const nomeCat = new Map((catDocs.data ?? []).map((c) => [c.codigo, c.nome]));
  const linhas: MovimentoPendente[] = movs.map((m) => ({
    id: m.id,
    data: m.data,
    valor: dec(m.valor).toFixed(2),
    descricao: m.descricao,
    conta_id: m.conta_financeira_id,
    conta_nome: nomeConta.get(m.conta_financeira_id) ?? "Conta",
    documento: m.documento_contraparte,
    em_sugestao: comSugestao.has(m.id),
  }));
  const documentos = ((docs.data ?? []) as { id: string; titulo: string | null; nome_original: string; competencia: string; categoria_codigo: string }[]).map(
    (d) => ({ id: d.id, nome: d.titulo || d.nome_original, competencia: d.competencia, categoria: nomeCat.get(d.categoria_codigo) ?? d.categoria_codigo }),
  );
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA));

  return (
    <>
      <FiltroConta
        contas={contas}
        conta={conta}
        aba="pendentes"
        extra={
          <>
            <Select name="sentido" defaultValue={sentido} aria-label="Entradas ou saídas" className="w-full sm:w-44">
              <option value="">Entradas e saídas</option>
              <option value="entradas">Somente entradas</option>
              <option value="saidas">Somente saídas</option>
            </Select>
            <Input type="date" name="inicio" defaultValue={inicio} aria-label="De" className="w-full sm:w-40" />
            <Input type="date" name="fim" defaultValue={fim} aria-label="Até" className="w-full sm:w-40" />
            <Input name="busca" defaultValue={busca} placeholder="Descrição" aria-label="Buscar na descrição" className="w-full sm:w-52" />
          </>
        }
      />
      {linhas.length ? (
        <>
          {podeExecutar ? (
            <p className="mb-3 text-sm text-muted-foreground">
              <strong>Conciliar</strong> liga a movimentação a um lançamento, a um pagamento já registrado ou a uma transferência.{" "}
              <strong>Classificar</strong> cria o lançamento quando ele ainda não existe (ex.: tarifas). Selecione várias para conciliar juntas.
            </p>
          ) : null}
          <TabelaPendentes
            empresaId={empresaId}
            linhas={linhas}
            podeExecutar={podeExecutar}
            podeClassificar={podeExecutar && ctx.pode("financeiro.editar")}
            opcoes={{
              categorias: opcoes?.categorias ?? [],
              contrapartes: opcoes?.contrapartes ?? [],
              centros: opcoes?.centros ?? [],
              documentos,
            }}
          />
          <Paginacao
            pagina={pagina}
            totalPaginas={totalPaginas}
            total={count ?? 0}
            montarHref={(p) => urlCom(`/e/${empresaId}/conciliacao`, sp, { aba: "pendentes", pagina: p })}
          />
        </>
      ) : (
        <EstadoVazio
          icone={CircleCheck}
          titulo={busca || sentido || inicio || fim || conta ? "Nenhuma movimentação pendente com estes filtros" : "Nenhuma movimentação pendente"}
          descricao="Quando você importar um extrato, as movimentações que ainda não foram conciliadas aparecem aqui."
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ conciliadas / histórico
interface ConciliacaoBruta {
  id: string;
  tipo: string;
  origem: string;
  status: string;
  diferenca: number;
  tratamento_diferenca: string | null;
  observacao: string | null;
  confirmada_em: string | null;
  desfeita_em: string | null;
  motivo_desfazer: string | null;
  rejeitada_em: string | null;
  motivo_rejeicao: string | null;
  created_at: string;
  itens: {
    id: string;
    movimento: { id: string; data: string; valor: number; descricao: string } | null;
    lancamento: { id: string; descricao: string } | null;
    baixa: {
      id: string;
      data_pagamento: string;
      valor_total: number | null;
      juros: number;
      multa: number;
      desconto: number;
      taxas: number;
      lancamento: { id: string; descricao: string } | null;
    } | null;
    transferencia: { id: string; data: string; valor: number; descricao: string | null } | null;
  }[];
}

const TIPO_CONCILIACAO: Record<string, string> = {
  lancamento: "Lançamento",
  baixa: "Pagamento registrado",
  transferencia: "Transferência",
  classificacao: "Classificação",
};

async function AbaConciliadas({ ctx, empresaId, conta, contas, sp, podeExecutar }: PropsAba) {
  const situacao = parametro(sp, "situacao", ["confirmada", "desfeita", "rejeitada"]) || "confirmada";
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const ordem = situacao === "confirmada" ? "confirmada_em" : situacao === "desfeita" ? "desfeita_em" : "rejeitada_em";
  let q = ctx.supabase
    .from("conciliacoes")
    .select(
      "id, tipo, origem, status, diferenca, tratamento_diferenca, observacao, confirmada_em, desfeita_em, motivo_desfazer, rejeitada_em, motivo_rejeicao, created_at, itens:conciliacao_itens(id, movimento:movimentos_bancarios(id, data, valor, descricao), lancamento:lancamentos(id, descricao), baixa:baixas(id, data_pagamento, valor_total, juros, multa, desconto, taxas, lancamento:lancamentos(id, descricao)), transferencia:transferencias(id, data, valor, descricao))",
      { count: "exact" },
    )
    .eq("empresa_id", empresaId)
    .eq("status", situacao);
  if (conta) q = q.eq("conta_financeira_id", conta);
  const { data, count, error } = await q.order(ordem, { ascending: false }).range((pagina - 1) * 50, pagina * 50 - 1);
  if (error) return <Alerta tom="perigo">Não foi possível carregar o histórico: {error.message}</Alerta>;
  const linhas = (data ?? []) as unknown as ConciliacaoBruta[];
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / 50));

  return (
    <>
      <FiltroConta
        contas={contas}
        conta={conta}
        aba="conciliadas"
        extra={
          <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full sm:w-48">
            <option value="confirmada">Confirmadas</option>
            <option value="desfeita">Desfeitas</option>
            <option value="rejeitada">Sugestões rejeitadas</option>
          </Select>
        }
      />
      {linhas.length ? (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Quando</Th>
                <Th>Extrato do banco</Th>
                <Th>No sistema</Th>
                <Th>Detalhes</Th>
                {podeExecutar && situacao === "confirmada" ? <Th className="text-right">Ações</Th> : null}
              </tr>
            </THead>
            <TBody>
              {linhas.map((c) => {
                const movs = c.itens.flatMap((i) => (i.movimento ? [i.movimento] : []));
                const baixas = c.itens.flatMap((i) => (i.baixa ? [i.baixa] : []));
                const lancs = c.itens.flatMap((i) => (i.lancamento ? [i.lancamento] : []));
                const transfs = c.itens.flatMap((i) => (i.transferencia ? [i.transferencia] : []));
                const quando = c.confirmada_em ?? c.desfeita_em ?? c.rejeitada_em ?? c.created_at;
                return (
                  <Tr key={c.id}>
                    <Td className="whitespace-nowrap text-sm">
                      {formatarDataHora(situacao === "confirmada" ? c.confirmada_em : situacao === "desfeita" ? c.desfeita_em : c.rejeitada_em) ||
                        formatarDataHora(quando)}
                    </Td>
                    <Td className="max-w-[18rem] space-y-1">
                      {movs.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate" title={m.descricao}>
                              {m.descricao}
                            </span>
                            <span className="block text-xs text-muted-foreground">{formatarData(m.data)}</span>
                          </span>
                          <ValorSinal valor={dec(m.valor).toFixed(2)} />
                        </div>
                      ))}
                    </Td>
                    <Td className="max-w-[18rem] space-y-1 text-sm">
                      {baixas.length
                        ? baixas.map((b) => (
                            <div key={b.id}>
                              {b.lancamento ? (
                                <Link href={`/e/${empresaId}/financeiro/lancamentos/${b.lancamento.id}`} className="block truncate hover:underline">
                                  {b.lancamento.descricao}
                                </Link>
                              ) : (
                                <span className="block truncate">Pagamento</span>
                              )}
                              <span className="block text-xs text-muted-foreground">
                                {formatarMoeda(b.valor_total)}
                                {dec(b.juros).isPositive() ? ` · juros ${formatarMoeda(b.juros)}` : ""}
                                {dec(b.multa).isPositive() ? ` · multa ${formatarMoeda(b.multa)}` : ""}
                                {dec(b.desconto).isPositive() ? ` · desconto ${formatarMoeda(b.desconto)}` : ""}
                                {dec(b.taxas).isPositive() ? ` · taxa ${formatarMoeda(b.taxas)}` : ""}
                              </span>
                            </div>
                          ))
                        : lancs.map((l) => (
                            <Link key={l.id} href={`/e/${empresaId}/financeiro/lancamentos/${l.id}`} className="block truncate hover:underline">
                              {l.descricao}
                            </Link>
                          ))}
                      {transfs.map((t) => (
                        <span key={t.id} className="block truncate">
                          {t.descricao ?? "Transferência"} · {formatarMoeda(t.valor)}
                        </span>
                      ))}
                    </Td>
                    <Td className="space-y-1 text-xs">
                      <div className="flex flex-wrap gap-1">
                        <Badge variante="contorno">{TIPO_CONCILIACAO[c.tipo] ?? c.tipo}</Badge>
                        <Badge variante={c.origem === "automatica" ? "info" : "neutro"}>{c.origem === "automatica" ? "Sugestão automática" : "Manual"}</Badge>
                      </div>
                      {c.tratamento_diferenca ? (
                        <p className="text-muted-foreground">
                          Diferença de {formatarMoeda(dec(c.diferenca).abs())}: {ROTULO_TRATAMENTO[c.tratamento_diferenca as Tratamento] ?? c.tratamento_diferenca}
                        </p>
                      ) : null}
                      {c.observacao ? <p className="text-muted-foreground">Obs.: {c.observacao}</p> : null}
                      {c.motivo_desfazer ? <p className="text-muted-foreground">Motivo: {c.motivo_desfazer}</p> : null}
                      {c.motivo_rejeicao ? <p className="text-muted-foreground">Motivo: {c.motivo_rejeicao}</p> : null}
                    </Td>
                    {podeExecutar && situacao === "confirmada" ? (
                      <Td className="text-right">
                        <DesfazerConciliacao empresaId={empresaId} conciliacaoId={c.id} />
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Paginacao
            pagina={pagina}
            totalPaginas={totalPaginas}
            total={count ?? 0}
            montarHref={(p) => urlCom(`/e/${empresaId}/conciliacao`, sp, { aba: "conciliadas", pagina: p })}
          />
        </>
      ) : (
        <EstadoVazio icone={GitCompareArrows} titulo="Nada por aqui ainda" descricao="As conciliações confirmadas, desfeitas e rejeitadas ficam registradas nesta lista." />
      )}
    </>
  );
}

// ------------------------------------------------------------------ ignoradas
async function AbaIgnoradas({ ctx, empresaId, conta, contas, sp, podeExecutar }: PropsAba) {
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  let q = ctx.supabase
    .from("movimentos_bancarios")
    .select("id, data, valor, descricao, conta_financeira_id, ignorado_motivo, ignorado_em", { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("status_conciliacao", "ignorado");
  if (conta) q = q.eq("conta_financeira_id", conta);
  const { data, count, error } = await q.order("ignorado_em", { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as movimentações: {error.message}</Alerta>;
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const linhas = data ?? [];
  return (
    <>
      <FiltroConta contas={contas} conta={conta} aba="ignoradas" />
      {linhas.length ? (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Data</Th>
                <Th>Descrição no extrato</Th>
                <Th className="text-right">Valor</Th>
                <Th>Motivo</Th>
                {podeExecutar ? <Th className="text-right">Ações</Th> : null}
              </tr>
            </THead>
            <TBody>
              {linhas.map((m) => (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap text-sm">{formatarData(m.data)}</Td>
                  <Td className="max-w-[20rem]">
                    <p className="truncate" title={m.descricao}>
                      {m.descricao}
                    </p>
                    <p className="text-xs text-muted-foreground">{nomeConta.get(m.conta_financeira_id)}</p>
                  </Td>
                  <Td className="text-right">
                    <ValorSinal valor={dec(m.valor).toFixed(2)} />
                  </Td>
                  <Td className="max-w-[16rem] text-sm">
                    <p className="truncate" title={m.ignorado_motivo ?? ""}>
                      {m.ignorado_motivo}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatarDataHora(m.ignorado_em)}</p>
                  </Td>
                  {podeExecutar ? (
                    <Td className="text-right">
                      <BotaoReativar empresaId={empresaId} movimentoId={m.id} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
          <Paginacao
            pagina={pagina}
            totalPaginas={Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))}
            total={count ?? 0}
            montarHref={(p) => urlCom(`/e/${empresaId}/conciliacao`, sp, { aba: "ignoradas", pagina: p })}
          />
        </>
      ) : (
        <EstadoVazio icone={Inbox} titulo="Nenhuma movimentação ignorada" />
      )}
    </>
  );
}

// ------------------------------------------------------------------ conferência de saldos
async function AbaSaldos({ ctx, empresaId, contas, sp }: Omit<PropsAba, "conta" | "podeExecutar">) {
  const competencia = parametro(sp, "competencia") || competenciaAtual().slice(0, 7);
  const { inicio, fim } = periodoDeParametros({ competencia, inicio: parametro(sp, "inicio"), fim: parametro(sp, "fim") });
  const [conf, saldos, semComprovante, semVinculo] = await Promise.all([
    ctx.supabase.rpc("conferencia_saldos", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }),
    ctx.supabase
      .from("extrato_saldos")
      .select("id, conta_financeira_id, data, saldo, fonte")
      .eq("empresa_id", empresaId)
      .gte("data", inicio)
      .lte("data", fim)
      .order("data", { ascending: false })
      .limit(50),
    ctx.supabase.rpc("movimentos_sem_comprovante", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }).limit(500),
    ctx.supabase.rpc("documentos_sem_vinculo", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }).limit(500),
  ]);
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const linhas = conf.data ?? [];
  const movsSem = (semComprovante.data ?? []) as { id: string; data: string; valor: number; descricao: string; status_conciliacao: string }[];
  const docsSem = (semVinculo.data ?? []) as { id: string; titulo: string | null; nome_original: string; competencia: string }[];
  const contasAtivas = contas.filter((c) => c.ativa);

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="aba" value="saldos" />
        <Select name="competencia" defaultValue={competencia} aria-label="Mês" className="w-full sm:w-56">
          {listaCompetencias(24, 0).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          <Search /> Ver mês
        </Button>
        {ctx.pode("financeiro.editar") ? (
          <div className="sm:ml-auto">
            <InformarSaldo empresaId={empresaId} contas={contasAtivas} hoje={hojeISO()} />
          </div>
        ) : null}
      </form>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Saldo do sistema × saldo do banco — {formatarCompetencia(inicio, true)}</h2>
        <p className="text-sm text-muted-foreground">
          O saldo do sistema é calculado pelos pagamentos, recebimentos e transferências registrados. O saldo do banco vem do extrato OFX importado ou do
          valor informado. Diferença zero significa que a conta está conferida.
        </p>
        {conf.error ? (
          <Alerta tom="perigo">Não foi possível calcular: {conf.error.message}</Alerta>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Conta</Th>
                <Th className="text-right">Saldo inicial</Th>
                <Th className="text-right">Entradas</Th>
                <Th className="text-right">Saídas</Th>
                <Th className="text-right">Saldo final (sistema)</Th>
                <Th className="text-right">Saldo do banco</Th>
                <Th className="text-right">Diferença</Th>
                <Th className="text-right">Pendentes</Th>
              </tr>
            </THead>
            <TBody>
              {linhas.map((l) => {
                const dif = l.diferenca === null ? null : dec(l.diferenca);
                return (
                  <Tr key={l.conta_id}>
                    <Td className="font-medium">{l.conta_nome}</Td>
                    <Td className="text-right numero">{formatarMoeda(l.saldo_inicial_sistema)}</Td>
                    <Td className="text-right numero text-sucesso">{formatarMoeda(l.entradas_sistema)}</Td>
                    <Td className="text-right numero text-perigo">{formatarMoeda(l.saidas_sistema)}</Td>
                    <Td className="text-right font-semibold numero">{formatarMoeda(l.saldo_final_sistema)}</Td>
                    <Td className="text-right numero">
                      {l.saldo_extrato === null ? (
                        <span className="text-xs text-muted-foreground">não informado</span>
                      ) : (
                        <>
                          {formatarMoeda(l.saldo_extrato)}
                          <span className="block text-xs text-muted-foreground">em {formatarData(l.saldo_extrato_data)}</span>
                        </>
                      )}
                    </Td>
                    <Td className="text-right">
                      {dif === null ? (
                        "—"
                      ) : dif.isZero() ? (
                        <Badge variante="sucesso">Conferido</Badge>
                      ) : (
                        <Badge variante="perigo">{formatarMoeda(dif, { sinal: true })}</Badge>
                      )}
                    </Td>
                    <Td className="text-right">
                      {l.movimentos_pendentes ? (
                        <Link
                          className="text-sm text-primary hover:underline"
                          href={urlCom(`/e/${empresaId}/conciliacao`, {}, { aba: "pendentes", conta: l.conta_id, inicio, fim })}
                        >
                          {l.movimentos_pendentes}
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">0</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        {linhas.some((l) => l.diferenca !== null && !dec(l.diferenca).isZero()) ? (
          <Alerta tom="alerta" titulo="Há diferença entre o sistema e o banco">
            Causas comuns: movimentações ainda pendentes de conciliação, pagamentos registrados na conta errada, saldo inicial da conta incorreto ou
            lançamentos em duplicidade. Concilie as pendências do período e confira o saldo inicial em Financeiro → Contas e saldos.
          </Alerta>
        ) : null}
      </section>

      {saldos.data?.length ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Saldos do banco registrados no mês</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {saldos.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {nomeConta.get(s.conta_financeira_id)} · {formatarData(s.data)}{" "}
                  <span className="text-xs text-muted-foreground">({s.fonte === "manual" ? "informado manualmente" : `extrato ${s.fonte.toUpperCase()}`})</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold numero">{formatarMoeda(s.saldo)}</span>
                  {s.fonte === "manual" && ctx.pode("financeiro.editar") ? <ExcluirSaldo empresaId={empresaId} saldoId={s.id} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Movimentações sem comprovante ({movsSem.length})</h2>
          <p className="text-sm text-muted-foreground">Pagamentos e recebimentos do extrato que ainda não têm nota, boleto ou comprovante ligado ao lançamento.</p>
          {movsSem.length ? (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {movsSem.slice(0, 100).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{m.descricao}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatarData(m.data)} · {m.status_conciliacao === "pendente" ? "não conciliada" : "conciliada"}
                    </span>
                  </span>
                  <ValorSinal valor={dec(m.valor).toFixed(2)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sucesso">Todas as movimentações do mês têm comprovante.</p>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Documentos sem lançamento ({docsSem.length})</h2>
          <p className="text-sm text-muted-foreground">Notas, boletos e comprovantes enviados no mês que ainda não estão ligados a nenhum lançamento.</p>
          {docsSem.length ? (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {docsSem.slice(0, 100).map((d) => (
                <li key={d.id} className="px-3 py-2 text-sm">
                  <Link href={`/e/${empresaId}/documentos/${d.id}`} className="block truncate hover:underline">
                    {d.titulo || d.nome_original}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatarCompetencia(d.competencia)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sucesso">Todos os documentos do mês estão vinculados.</p>
          )}
        </section>
      </div>
    </div>
  );
}
