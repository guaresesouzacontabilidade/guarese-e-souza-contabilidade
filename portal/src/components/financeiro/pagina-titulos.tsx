import Link from "next/link";
import { Download, FileUp, Minus, Plus, Receipt, ReceiptText, Search } from "lucide-react";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { ListaTitulos, type LinhaTitulo } from "@/components/financeiro/lista-titulos";
import { hojeISO } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { buscarTudo } from "@/lib/supabase/paginar";
import { aplicarFiltros, colunaData, filtrosNaUrl, lerFiltros } from "@/lib/financeiro/filtros-titulos";
import { cn } from "@/lib/utils";

const POR_PAGINA = 50;

type Sp = Record<string, string | string[] | undefined>;

/**
 * Contas a pagar ou a receber: atalhos por prazo, filtros, totais do filtro
 * (valor original, já pago e saldo em aberto), a lista com ações em lote e a
 * planilha com os mesmos filtros.
 */
export async function PaginaTitulos({ ctx, empresaId, tipo, sp }: { ctx: ContextoEmpresa; empresaId: string; tipo: "pagar" | "receber"; sp: Sp }) {
  const hoje = hojeISO();
  const f = lerFiltros(sp, tipo);
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const pagar = tipo === "pagar";
  const base = `/e/${empresaId}/financeiro/${tipo}`;
  const col = colunaData(f);
  const colunas =
    "id, tipo, descricao, data_competencia, data_vencimento, valor_previsto, valor_baixado, situacao, status_revisao, origem, parcela_numero, parcela_total, aprovacao_status, renegociacao_id, recorrencia_id, categoria:categorias_financeiras(nome), contraparte:contrapartes(nome), centro:centros_custo(nome)";

  const [{ data, count }, totais, painel, { data: categorias }, { data: contrapartes }, { data: centros }, { data: contas }, { data: aConferir }] = await Promise.all([
    aplicarFiltros(ctx.supabase.from("lancamentos").select(colunas, { count: "exact" }).eq("empresa_id", empresaId), f, hoje)
      .order(col, { ascending: f.ordem === "crescente" })
      .order("id")
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    buscarTudo(
      (de, ate) =>
        aplicarFiltros(ctx.supabase.from("lancamentos").select("valor_previsto, valor_baixado, situacao, data_vencimento, status_revisao").eq("empresa_id", empresaId), f, hoje).range(de, ate),
      20000,
    ),
    ctx.supabase.rpc("financeiro_painel", { p_empresa_id: empresaId }),
    ctx.supabase.from("categorias_financeiras").select("id, nome, codigo, natureza, sintetica").eq("empresa_id", empresaId).eq("ativa", true).order("codigo"),
    ctx.supabase.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(2000),
    ctx.supabase.from("centros_custo").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("contas_financeiras").select("id, nome").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    // Em aberto que ainda não foram conferidos (vieram de nota, extrato ou importação): ficam fora dos atalhos e da Visão geral
    ctx.supabase.from("lancamentos").select("valor_previsto, valor_baixado").eq("empresa_id", empresaId).eq("tipo", tipo).eq("status_revisao", "sugerido").in("situacao", ["aberto", "parcial"]).limit(5000),
  ]);

  const natureza = pagar ? "despesa" : "receita";
  const linhas: LinhaTitulo[] = (data ?? []).map((l) => ({
    id: l.id,
    descricao: l.descricao,
    categoria: (l.categoria as { nome: string } | null)?.nome ?? null,
    contraparte: (l.contraparte as { nome: string } | null)?.nome ?? null,
    centro: (l.centro as { nome: string } | null)?.nome ?? null,
    competencia: l.data_competencia,
    vencimento: l.data_vencimento,
    valor: dec(l.valor_previsto).toFixed(2),
    pago: dec(l.valor_baixado).toFixed(2),
    saldo: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
    situacao: l.situacao,
    vencido: ["aberto", "parcial"].includes(l.situacao) && l.data_vencimento < hoje,
    diasAtraso: ["aberto", "parcial"].includes(l.situacao) && l.data_vencimento < hoje ? Math.round((Date.parse(hoje) - Date.parse(l.data_vencimento)) / 86_400_000) : 0,
    revisao: l.status_revisao,
    origem: l.origem,
    parcela: l.parcela_numero ? `${l.parcela_numero}/${l.parcela_total}` : null,
    aprovacao: l.aprovacao_status,
    acordo: Boolean(l.renegociacao_id),
    recorrente: Boolean(l.recorrencia_id),
  }));

  const validos = totais.filter((t) => t.situacao !== "cancelado" && t.situacao !== "renegociado");
  const totalOriginal = somar(validos.map((t) => t.valor_previsto));
  const totalPago = somar(validos.map((t) => t.valor_baixado));
  const abertos = validos.filter((t) => t.situacao === "aberto" || t.situacao === "parcial");
  const totalAberto = somar(abertos.map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado))));
  const totalVencido = somar(abertos.filter((t) => t.data_vencimento < hoje).map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado))));
  const abertoAConferir = somar(abertos.filter((t) => t.status_revisao === "sugerido").map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado))));
  const conferir = { qtd: (aConferir ?? []).length, total: somar((aConferir ?? []).map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado)))).toNumber() };

  // Atalhos por prazo: contagem e saldo do painel (só o que já foi conferido, como na Visão geral). Ao clicar, a lista mostra o mesmo.
  const p = (painel.data ?? null) as { titulos?: Record<string, Record<string, { total: number; qtd: number }>>; pendencias?: { aprovacoes: number; sugeridos: number } } | null;
  const b = p?.titulos?.[tipo];
  const atalhos: { rotulo: string; href: string; ativo: boolean; total?: number; qtd?: number; tom?: "perigo" | "alerta" }[] = [
    { rotulo: "Em aberto", href: urlCom(base, {}, { situacao: "em_aberto", revisao: "confirmado" }), ativo: f.situacao === "em_aberto" && !f.prazo && !f.aprovacao && f.revisao === "confirmado", total: b?.total?.total, qtd: b?.total?.qtd },
    { rotulo: "Vencidos", href: urlCom(base, {}, { prazo: "vencido", revisao: "confirmado" }), ativo: f.prazo === "vencido", total: b?.vencido?.total, qtd: b?.vencido?.qtd, tom: "perigo" },
    { rotulo: "Vence hoje", href: urlCom(base, {}, { prazo: "hoje", revisao: "confirmado" }), ativo: f.prazo === "hoje", total: b?.hoje?.total, qtd: b?.hoje?.qtd, tom: "alerta" },
    { rotulo: "Próximos 7 dias", href: urlCom(base, {}, { prazo: "proximos7", revisao: "confirmado" }), ativo: f.prazo === "proximos7", total: b?.d7?.total, qtd: b?.d7?.qtd },
    { rotulo: "Próximos 30 dias", href: urlCom(base, {}, { prazo: "proximos30", revisao: "confirmado" }), ativo: f.prazo === "proximos30", total: b?.d30?.total, qtd: b?.d30?.qtd },
    ...(pagar && (p?.pendencias?.aprovacoes ?? 0) > 0
      ? [{ rotulo: "Aguardando aprovação", href: urlCom(base, {}, { aprovacao: "pendente", situacao: "em_aberto" }), ativo: f.aprovacao === "pendente", qtd: p?.pendencias?.aprovacoes, tom: "alerta" as const }]
      : []),
    ...(conferir.qtd > 0
      ? [{ rotulo: "A conferir", href: urlCom(base, {}, { revisao: "sugerido", situacao: "em_aberto" }), ativo: f.revisao === "sugerido" && !f.prazo, total: conferir.total, qtd: conferir.qtd, tom: "alerta" as const }]
      : []),
    { rotulo: "Liquidados", href: urlCom(base, {}, { situacao: "quitado" }), ativo: f.situacao === "quitado" },
  ];

  // Algum filtro de "Mais filtros" em uso: o bloco já abre
  const maisFiltros = Boolean(f.contraparte || f.categoria || f.centro || f.aprovacao || f.inicio || f.fim || f.por === "competencia" || (typeof sp.ordem === "string" && sp.ordem));
  const consulta = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string" && v) as [string, string][]).toString();
  const exportar = (formato: string) => urlCom(`/api/financeiro/exportar`, filtrosNaUrl(f), { empresa: empresaId, formato });
  const categoriasTipo = (categorias ?? []).filter((c) => !c.sintetica && c.natureza === natureza);

  return (
    <>
      <CabecalhoPagina
        titulo={pagar ? "Contas a pagar" : "Contas a receber"}
        descricao={
          pagar
            ? "O que a empresa tem para pagar: fornecedores, despesas fixas, impostos e parcelas. Baixe inteiro ou em parte, em lote, e veja o que está vencido."
            : "O que a empresa tem para receber: vendas a prazo, serviços, mensalidades e parcelas. Veja quem está atrasado e baixe inteiro ou em parte."
        }
        acoes={
          <>
            {ctx.pode("financeiro.exportar") ? (
              <>
                <Button asChild variante="contorno">
                  <a href={exportar("xlsx")}>
                    <Download /> Excel
                  </a>
                </Button>
                <Button asChild variante="contorno">
                  <a href={exportar("csv")}>
                    <Download /> CSV
                  </a>
                </Button>
              </>
            ) : null}
            {pagar ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/financeiro/notas`}>
                  <ReceiptText /> Notas de compra
                </Link>
              </Button>
            ) : null}
            {ctx.pode("financeiro.importar") ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/financeiro/importar`}>
                  <FileUp /> Importar
                </Link>
              </Button>
            ) : null}
            {ctx.pode("financeiro.editar") ? (
              <Button asChild>
                <Link href={`${base}/novo`}>
                  {pagar ? <Minus /> : <Plus />} {pagar ? "Nova despesa" : "Nova receita"}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Atalhos por prazo */}
      <nav aria-label="Atalhos" className="-mx-3 mb-4 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {atalhos.map((a) => (
            <li key={a.rotulo}>
              <Link
                href={a.href}
                aria-current={a.ativo ? "page" : undefined}
                className={cn(
                  "flex flex-col rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  a.ativo ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
                )}
              >
                <span className={cn("font-medium", a.tom === "perigo" && (a.qtd ?? 0) > 0 ? "text-perigo" : a.tom === "alerta" && (a.qtd ?? 0) > 0 ? "text-alerta-fg" : "")}>
                  {a.rotulo}
                  {a.qtd !== undefined ? <span className="ml-1 text-xs text-muted-foreground">({a.qtd})</span> : null}
                </span>
                {a.total !== undefined ? <span className="numero text-xs text-muted-foreground">{formatarMoeda(a.total)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Filtros */}
      <form className="mb-4 space-y-2" role="search">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="busca" defaultValue={f.busca} placeholder="Descrição ou nº do documento" className="pl-9" aria-label="Buscar" />
          </div>
          <Select name="situacao" defaultValue={f.situacao} aria-label="Situação do pagamento">
            <option value="nao_canceladas">Todas (sem canceladas)</option>
            <option value="em_aberto">Em aberto (inclui pagas em parte)</option>
            <option value="parcial">{pagar ? "Pagas em parte" : "Recebidas em parte"}</option>
            <option value="quitado">Liquidadas</option>
            <option value="renegociado">Renegociadas</option>
            <option value="cancelado">Canceladas</option>
            <option value="todos">Todas (com canceladas)</option>
          </Select>
          <Select name="prazo" defaultValue={f.prazo} aria-label="Prazo">
            <option value="">Qualquer vencimento</option>
            <option value="vencido">Vencidas</option>
            <option value="hoje">Vencem hoje</option>
            <option value="proximos7">Próximos 7 dias</option>
            <option value="proximos30">Próximos 30 dias</option>
            <option value="a_vencer">A vencer (depois de hoje)</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variante="secundario" className="flex-1">
              Filtrar
            </Button>
            <Button asChild variante="fantasma">
              <Link href={base}>Limpar</Link>
            </Button>
          </div>
        </div>
        <details className="rounded-xl border border-border bg-card/60" open={maisFiltros || undefined}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Mais filtros{" "}
            <span className="font-normal text-muted-foreground">— {pagar ? "fornecedor" : "cliente"}, categoria, centro de custo, {pagar ? "aprovação" : "revisão"}, período e ordem</span>
          </summary>
          <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select name="contraparte" defaultValue={f.contraparte} aria-label={pagar ? "Fornecedor" : "Cliente"}>
              <option value="">{pagar ? "Todos os fornecedores" : "Todos os clientes"}</option>
              {(contrapartes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
            <Select name="categoria" defaultValue={f.categoria} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {categoriasTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} {c.nome}
                </option>
              ))}
            </Select>
            <Select name="centro" defaultValue={f.centro} aria-label="Centro de custo">
              <option value="">Todos os centros de custo</option>
              {(centros ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
            {pagar ? (
              <Select name="aprovacao" defaultValue={f.aprovacao} aria-label="Aprovação">
                <option value="">Aprovação: qualquer</option>
                <option value="pendente">Aguardando aprovação</option>
                <option value="aprovado">Aprovados</option>
                <option value="reprovado">Reprovados</option>
              </Select>
            ) : (
              <Select name="revisao" defaultValue={f.revisao} aria-label="Revisão">
                <option value="">Confirmados e sugeridos</option>
                <option value="sugerido">Só sugeridos (a conferir)</option>
                <option value="confirmado">Só confirmados</option>
              </Select>
            )}
            <Select name="por" defaultValue={f.por} aria-label="Período por">
              <option value="vencimento">Período por vencimento</option>
              <option value="competencia">Período por competência</option>
            </Select>
            <Input type="date" name="inicio" defaultValue={f.inicio} aria-label="Data inicial" />
            <Input type="date" name="fim" defaultValue={f.fim} aria-label="Data final" />
            <Select name="ordem" defaultValue={f.ordem} aria-label="Ordem">
              <option value="crescente">Data mais antiga primeiro (hoje antes de 2027)</option>
              <option value="decrescente">Data mais nova primeiro</option>
            </Select>
          </div>
        </details>
      </form>

      {/* Totais do filtro */}
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4" data-testid="totais-titulos">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Valor original ({validos.length} título(s))</p>
          <p className="font-semibold numero">{formatarMoeda(totalOriginal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{pagar ? "Já pago" : "Já recebido"}</p>
          <p className="font-semibold text-sucesso numero">{formatarMoeda(totalPago)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Saldo em aberto</p>
          <p className="text-lg font-bold numero" data-testid="saldo-aberto-filtro">
            {formatarMoeda(totalAberto)}
          </p>
          {abertoAConferir.gt(0) && f.revisao !== "sugerido" ? (
            <p className="text-xs text-alerta-fg">inclui {formatarMoeda(abertoAConferir)} a conferir</p>
          ) : null}
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Vencido</p>
          <p className={cn("font-semibold numero", totalVencido.gt(0) ? "text-perigo" : "")}>{formatarMoeda(totalVencido)}</p>
        </div>
      </div>

      {linhas.length ? (
        <>
          <ListaTitulos
            empresaId={empresaId}
            tipo={tipo}
            linhas={linhas}
            hoje={hoje}
            voltar={consulta}
            permissoes={{ editar: ctx.pode("financeiro.editar"), baixar: ctx.pode("financeiro.baixar"), aprovar: ctx.pode("financeiro.aprovar") }}
            contas={contas ?? []}
            categorias={categoriasTipo.map((c) => ({ id: c.id, nome: `${c.codigo} ${c.nome}` }))}
            centros={centros ?? []}
          />
          <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(n) => urlCom(base, sp, { pagina: n })} />
        </>
      ) : (
        <EstadoVazio
          icone={Receipt}
          titulo="Nenhum título encontrado"
          descricao={pagar ? "Lance uma despesa, importe uma planilha ou confira os filtros." : "Lance uma receita, importe uma planilha ou confira os filtros."}
        />
      )}
    </>
  );
}
