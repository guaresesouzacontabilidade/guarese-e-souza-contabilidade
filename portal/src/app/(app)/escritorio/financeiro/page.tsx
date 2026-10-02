import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Building2, Search, Sparkles, Wallet } from "lucide-react";
import { exigirEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";
import { resumirCarteira, resumoVazio } from "@/lib/relatorios/carteira";
import { saldoDisponivel, type SaldoContaLinha } from "@/lib/relatorios/calculos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Financeiro da carteira" };
const POR_PAGINA = 25;

const ORDENS = {
  vencido_pagar: "Mais vencido a pagar",
  vencido_receber: "Mais vencido a receber",
  sugeridos: "Mais lançamentos sugeridos",
  nome: "Nome da empresa",
} as const;

export default async function FinanceiroCarteira({ searchParams }: PageProps<"/escritorio/financeiro">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const busca = termoBusca(sp.busca).toLocaleLowerCase("pt-BR");
  const digitos = busca.replace(/\D/g, "");
  const situacao = parametro(sp, "situacao", ["ativas", "todas", "pendencias"]) || "ativas";
  const ordem = (parametro(sp, "ordem", Object.keys(ORDENS)) || "vencido_pagar") as keyof typeof ORDENS;
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);

  // Empresas em que o usuário vê o financeiro (as consultas abaixo também passam pelo RLS)
  const empresas = (await obterEmpresasDoUsuario()).filter((e) => e.permissoes.has("financeiro.ver") && (situacao === "todas" || e.ativa));

  const [abertos, sugeridos, contas] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("lancamentos")
        .select("empresa_id, tipo, data_vencimento, valor_previsto, valor_baixado, conta:contas_financeiras(tipo)")
        .eq("status_revisao", "confirmado")
        .in("situacao", ["aberto", "parcial"])
        .order("id")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase.from("lancamentos").select("empresa_id").eq("status_revisao", "sugerido").neq("situacao", "cancelado").order("id").range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("contas_financeiras").select("empresa_id").eq("ativa", true).order("id").range(de, ate)),
  ]);

  const resumo = resumirCarteira(
    abertos.map((l) => ({ ...l, cartao: (l.conta as { tipo: string } | null)?.tipo === "cartao_credito" })),
    sugeridos,
    hoje,
  );
  const comContas = new Set(contas.map((c) => c.empresa_id));
  const linhas = empresas
    .map((e) => ({ empresa: e, nome: e.nome_fantasia ?? e.razao_social, r: resumo.get(e.id) ?? resumoVazio(), configurada: comContas.has(e.id) }))
    .filter(
      (l) =>
        !busca ||
        l.nome.toLocaleLowerCase("pt-BR").includes(busca) ||
        l.empresa.razao_social.toLocaleLowerCase("pt-BR").includes(busca) ||
        (digitos.length >= 3 && l.empresa.documento.includes(digitos)),
    )
    .filter((l) => situacao !== "pendencias" || l.r.titulosVencidos > 0 || l.r.sugeridos > 0);

  const porNome = (a: (typeof linhas)[number], b: (typeof linhas)[number]) => a.nome.localeCompare(b.nome, "pt-BR");
  linhas.sort((a, b) => {
    if (ordem === "vencido_pagar") return b.r.pagarVencido.comparedTo(a.r.pagarVencido) || porNome(a, b);
    if (ordem === "vencido_receber") return b.r.receberVencido.comparedTo(a.r.receberVencido) || porNome(a, b);
    if (ordem === "sugeridos") return b.r.sugeridos - a.r.sugeridos || porNome(a, b);
    return porNome(a, b);
  });

  const totalPaginas = Math.ceil(linhas.length / POR_PAGINA);
  const visiveis = linhas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  // Saldos: uma consulta por empresa visível (a função calcula por conta)
  const saldos = new Map(
    await Promise.all(
      visiveis.map(async (l) => {
        if (!l.configurada) return [l.empresa.id, null] as const;
        const { data } = await s.supabase.rpc("saldos_contas", { p_empresa_id: l.empresa.id, p_data: hoje });
        const contasEmpresa = (data ?? []) as SaldoContaLinha[];
        return [l.empresa.id, { ...saldoDisponivel(contasEmpresa), pendentes: contasEmpresa.reduce((t, c) => t + Number(c.movimentos_pendentes ?? 0), 0) }] as const;
      }),
    ),
  );

  const todos = linhas.map((l) => l.r);
  const receberVencido = somar(todos.map((r) => r.receberVencido));
  const pagarVencido = somar(todos.map((r) => r.pagarVencido));
  const totalSugeridos = todos.reduce((t, r) => t + r.sugeridos, 0);
  const comVencidos = linhas.filter((l) => l.r.titulosVencidos > 0).length;
  const semContas = linhas.filter((l) => !l.configurada).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Financeiro da carteira"
        descricao={`Contas a pagar e a receber, vencidos, saldos e lançamentos a revisar nas empresas que você acompanha · posição em ${formatarData(hoje)}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Empresas com vencidos" valor={comVencidos} detalhe={`de ${linhas.length} empresa(s)`} icone={AlertTriangle} tom={comVencidos ? "alerta" : "neutro"} />
        <Indicador rotulo="A receber vencido" valor={formatarMoeda(receberVencido)} detalhe="Soma das empresas listadas" icone={ArrowDownLeft} tom={receberVencido.isZero() ? "neutro" : "alerta"} />
        <Indicador rotulo="A pagar vencido" valor={formatarMoeda(pagarVencido)} detalhe="Soma das empresas listadas" icone={ArrowUpRight} tom={pagarVencido.isZero() ? "neutro" : "perigo"} />
        <Indicador rotulo="Lançamentos sugeridos" valor={totalSugeridos} detalhe="Aguardando revisão" icone={Sparkles} tom={totalSugeridos ? "info" : "neutro"} />
      </div>

      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={termoBusca(sp.busca)} placeholder="Buscar por nome ou CNPJ" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="situacao" defaultValue={situacao} aria-label="Empresas">
          <option value="ativas">Empresas ativas</option>
          <option value="pendencias">Com vencidos ou sugeridos</option>
          <option value="todas">Todas (inclui inativas)</option>
        </Select>
        <Select name="ordem" defaultValue={ordem} aria-label="Ordenar por">
          {Object.entries(ORDENS).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button type="submit" variante="secundario" className="flex-1">
            Filtrar
          </Button>
          <Button asChild variante="fantasma">
            <Link href="/escritorio/financeiro">Limpar</Link>
          </Button>
        </div>
      </form>

      {semContas > 0 ? (
        <Alerta tom="info" className="mb-4">
          {semContas} empresa(s) ainda sem contas financeiras cadastradas: saldos e fluxo de caixa ficam indisponíveis até o cadastro.
        </Alerta>
      ) : null}

      {!visiveis.length ? (
        <EstadoVazio
          icone={empresas.length ? Wallet : Building2}
          titulo={empresas.length ? "Nenhuma empresa encontrada com estes filtros" : "Nenhuma empresa com acesso ao financeiro"}
          descricao={empresas.length ? "Altere a busca ou os filtros." : "O financeiro aparece aqui para as empresas em que você tem permissão de visualizar o financeiro."}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Empresa</Th>
                <Th className="text-right">Saldo disponível</Th>
                <Th className="text-right">A receber</Th>
                <Th className="text-right">A pagar</Th>
                <Th className="hidden text-right lg:table-cell">A pagar em 7 dias</Th>
                <Th>Revisão</Th>
              </tr>
            </THead>
            <TBody>
              {visiveis.map(({ empresa: e, nome, r, configurada }) => {
                const b = `/e/${e.id}/financeiro`;
                const saldo = saldos.get(e.id);
                return (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={b} className="font-medium text-titulo hover:underline">
                        {nome}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatarDocumento(e.documento)}
                        {!e.ativa ? " · inativa" : ""}
                        {e.demonstracao ? " · demonstração" : ""}
                      </p>
                    </Td>
                    <Td className="text-right numero">
                      {!configurada ? (
                        <span className="text-xs text-muted-foreground">Sem contas</span>
                      ) : saldo?.valor ? (
                        <Link href={`${b}/contas`} className={cn("hover:underline", saldo.valor.isNegative() && "text-perigo")}>
                          {formatarMoeda(saldo.valor)}
                          {saldo.incompleto ? <span className="block text-xs text-muted-foreground">sem saldo inicial em alguma conta</span> : null}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-right numero">
                      <Link href={`${b}/lancamentos?tipo=receber&situacao=em_aberto`} className="hover:underline">
                        {formatarMoeda(r.receberAberto)}
                      </Link>
                      {r.receberVencido.isZero() ? null : (
                        <Link href={`${b}/lancamentos?tipo=receber&situacao=atrasado`} className="block text-xs text-alerta hover:underline">
                          vencido {formatarMoeda(r.receberVencido)}
                        </Link>
                      )}
                    </Td>
                    <Td className="text-right numero">
                      <Link href={`${b}/lancamentos?tipo=pagar&situacao=em_aberto`} className="hover:underline">
                        {formatarMoeda(r.pagarAberto)}
                      </Link>
                      {r.pagarVencido.isZero() ? null : (
                        <Link href={`${b}/lancamentos?tipo=pagar&situacao=atrasado`} className="block text-xs text-perigo hover:underline">
                          vencido {formatarMoeda(r.pagarVencido)}
                        </Link>
                      )}
                    </Td>
                    <Td className="hidden text-right numero lg:table-cell">{formatarMoeda(r.pagar7)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.sugeridos ? (
                          <Link href={`${b}/lancamentos?revisao=sugerido`}>
                            <Badge variante="info">
                              <Sparkles /> {r.sugeridos} sugerido(s)
                            </Badge>
                          </Link>
                        ) : null}
                        {saldo?.pendentes ? <Badge variante="alerta">{saldo.pendentes} a conciliar</Badge> : null}
                        {!r.sugeridos && !saldo?.pendentes ? <span className="text-xs text-muted-foreground">Em dia</span> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={linhas.length} montarHref={(p) => urlCom("/escritorio/financeiro", sp, { pagina: p })} />
          <p className="mt-3 text-xs text-muted-foreground">
            Valores em aberto de lançamentos confirmados (compras no cartão entram pela fatura). O saldo disponível soma bancos e caixa pelo que foi registrado no
            portal; “a conciliar” são movimentações bancárias importadas ainda sem conciliação.
          </p>
        </>
      )}
    </>
  );
}
