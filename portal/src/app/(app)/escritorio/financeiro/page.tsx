import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Landmark, Search, TrendingDown, TrendingUp } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Dinheiro } from "@/components/relatorios/tabelas";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarCompetencia } from "@/lib/formatos";

export const metadata: Metadata = { title: "Financeiro da carteira" };

const ORDENS = {
  alerta: "Mais alertas primeiro",
  resultado: "Menor resultado primeiro",
  saldo: "Menor saldo primeiro",
  nome: "Nome",
} as const;

export default async function FinanceiroCarteira({ searchParams }: PageProps<"/escritorio/financeiro">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const ordem = (parametro(sp, "ordem", Object.keys(ORDENS)) || "alerta") as keyof typeof ORDENS;
  const busca = termoBusca(sp.busca).toLowerCase();
  const hoje = hojeISO();

  const [empresas, resumo] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
        .eq("ativa", true)
        .order("razao_social")
        .range(de, ate),
    ),
    s.supabase.rpc("resumo_financeiro_carteira", { p_inicio: comp, p_fim: ultimoDiaDoMes(comp) }),
  ]);
  if (resumo.error) return <Alerta tom="perigo">Não foi possível carregar o resumo: {resumo.error.message}</Alerta>;
  const porEmpresa = new Map((resumo.data ?? []).map((r) => [r.empresa_id, r]));

  const linhas = empresas
    .filter((e) => porEmpresa.has(e.id))
    .map((e) => {
      const r = porEmpresa.get(e.id)!;
      const saldo = r.saldo_disponivel === null ? null : dec(r.saldo_disponivel);
      const projetado = saldo === null ? null : saldo.plus(r.receber_30).minus(r.pagar_30);
      const alertas: string[] = [];
      if (saldo?.lessThan(0)) alertas.push("caixa negativo");
      if (projetado?.lessThan(0)) alertas.push("caixa negativo em 30 dias");
      if (dec(r.resultado).lessThan(0)) alertas.push("prejuízo no mês");
      if (dec(r.pagar_vencido).greaterThan(0)) alertas.push("contas vencidas");
      if (dec(r.receber_vencido).greaterThan(dec(r.receita).times(0.15)) && dec(r.receber_vencido).greaterThan(0)) alertas.push("inadimplência alta");
      if (r.sugeridos) alertas.push(`${r.sugeridos} sugerido(s) a revisar`);
      return { id: e.id, nome: e.nome_fantasia || e.razao_social, razao: e.razao_social, contador: (e.contador as { nome: string } | null)?.nome ?? null, r, saldo, projetado, alertas };
    })
    .filter((l) => !busca || l.nome.toLowerCase().includes(busca) || l.razao.toLowerCase().includes(busca))
    .sort((a, b) => {
      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      if (ordem === "resultado") return dec(a.r.resultado).comparedTo(dec(b.r.resultado));
      if (ordem === "saldo") return (a.saldo ?? dec(0)).comparedTo(b.saldo ?? dec(0));
      return b.alertas.length - a.alertas.length || a.nome.localeCompare(b.nome, "pt-BR");
    });

  const todas = resumo.data ?? [];
  const totalReceita = somar(todas.map((r) => r.receita));
  const comPrejuizo = todas.filter((r) => dec(r.resultado).lessThan(0)).length;
  const caixaNegativo = linhas.filter((l) => l.saldo?.lessThan(0) || l.projetado?.lessThan(0)).length;
  const vencidos = somar(todas.map((r) => r.pagar_vencido));

  return (
    <>
      <CabecalhoPagina
        titulo="Financeiro da carteira"
        descricao={`Visão rápida de cada empresa: caixa hoje (${hoje.split("-").reverse().join("/")}), contas e resultado de ${formatarCompetencia(comp, true)}.`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Faturamento da carteira" valor={formatarMoeda(totalReceita)} icone={TrendingUp} detalhe={formatarCompetencia(comp, true)} />
        <Indicador rotulo="Empresas com prejuízo" valor={comPrejuizo} icone={TrendingDown} tom={comPrejuizo ? "alerta" : "sucesso"} href="?ordem=resultado" />
        <Indicador rotulo="Caixa negativo (hoje ou em 30 dias)" valor={caixaNegativo} icone={Landmark} tom={caixaNegativo ? "perigo" : "sucesso"} href="?ordem=saldo" />
        <Indicador rotulo="Contas a pagar vencidas" valor={formatarMoeda(vencidos)} icone={AlertTriangle} tom={vencidos.greaterThan(0) ? "alerta" : "sucesso"} />
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Mês do resultado" className="w-full sm:w-52">
          {listaCompetencias(18, 0).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="ordem" defaultValue={ordem} aria-label="Ordenar" className="w-full sm:w-56">
          {Object.entries(ORDENS).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>
      {linhas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th className="text-right">Saldo hoje</Th>
              <Th className="text-right">Em 30 dias</Th>
              <Th className="text-right">Vencidos (receber / pagar)</Th>
              <Th className="text-right">Receita do mês</Th>
              <Th className="text-right">Resultado</Th>
            </tr>
          </THead>
          <TBody>
            {linhas.map((l) => (
              <Tr key={l.id}>
                <Td className="max-w-[18rem]">
                  <Link href={`/e/${l.id}/relatorios?periodo=${comp.slice(0, 7)}`} className="block truncate font-medium hover:underline" title={l.razao}>
                    {l.nome}
                  </Link>
                  {l.contador ? <p className="truncate text-xs text-muted-foreground">{l.contador}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.alertas.length ? (
                      l.alertas.map((a) => (
                        <Badge key={a} variante={a.startsWith("caixa") || a === "prejuízo no mês" ? "perigo" : "alerta"}>
                          {a}
                        </Badge>
                      ))
                    ) : (
                      <Badge variante="sucesso">sem alertas</Badge>
                    )}
                  </div>
                </Td>
                <Td className="text-right">{l.saldo === null ? <span className="text-xs text-muted-foreground">sem saldo inicial</span> : <Dinheiro v={l.saldo.toFixed(2)} sinal />}</Td>
                <Td className="text-right">{l.projetado === null ? "—" : <Dinheiro v={l.projetado.toFixed(2)} sinal />}</Td>
                <Td className="whitespace-nowrap text-right text-sm">
                  <Dinheiro v={l.r.receber_vencido} /> / <Dinheiro v={l.r.pagar_vencido} />
                </Td>
                <Td className="text-right">
                  <Dinheiro v={l.r.receita} />
                </Td>
                <Td className="text-right">
                  <Dinheiro v={l.r.resultado} sinal forte />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={Landmark} titulo="Nenhuma empresa com financeiro para mostrar" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Saldo das contas que compõem o caixa (bancos e caixa). “Em 30 dias” soma o que vence a receber e a pagar no período (vencidos à parte). Resultado pela
        competência, só com lançamentos confirmados.
      </p>
    </>
  );
}
