import type { Metadata } from "next";
import Link from "next/link";
import { FileQuestion, FileSpreadsheet } from "lucide-react";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ExcluirLancamento, FormLancamento } from "@/components/honorarios/lancamentos";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { parametro } from "@/lib/busca";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Lançamentos do escritório" };

export default async function Lancamentos({ searchParams }: PageProps<"/escritorio/honorarios/lancamentos">) {
  const s = await exigirHonorarios();
  const sp = await searchParams;
  const ver = parametro(sp, "ver", ["todos", "classificar", "receita", "despesa"]) || "todos";
  const mes = lerCompetencia(parametro(sp, "mes")) ?? competenciaAtual();
  const hoje = hojeISO();
  const base = "/escritorio/honorarios/lancamentos";

  let q = s.supabase
    .from("escritorio_lancamentos")
    .select("id, natureza, data, competencia, descricao, valor, categoria_id, empresa_id, origem, forma_pagamento, categoria:escritorio_categorias(codigo, nome)")
    .order("data", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (ver === "classificar") q = q.is("categoria_id", null);
  else q = q.gte("data", mes).lte("data", ultimoDiaDoMes(mes));
  if (ver === "receita" || ver === "despesa") q = q.eq("natureza", ver);
  const [{ data: lancamentos }, { data: categorias }, empresas, { count: aClassificar }] = await Promise.all([
    q,
    s.supabase.from("escritorio_categorias").select("id, codigo, nome, tipo").eq("ativa", true).order("codigo"),
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social").range(de, ate)),
    s.supabase.from("escritorio_lancamentos").select("id", { count: "exact", head: true }).is("categoria_id", null),
  ]);
  const lista = lancamentos ?? [];
  const opcoesEmpresas = empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social }));
  const entradas = somar(lista.filter((l) => l.natureza === "receita").map((l) => l.valor));
  const saidas = somar(lista.filter((l) => l.natureza === "despesa").map((l) => l.valor));

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo="Lançamentos do escritório"
        descricao="Tudo o que entra e sai do escritório. Os pagamentos de cobranças entram sozinhos; despesas e outras receitas você lança aqui."
        voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }}
        acoes={
          <>
            <FormLancamento categorias={categorias ?? []} empresas={opcoesEmpresas} hoje={hoje} naturezaInicial="receita" rotulo="Nova entrada" />
            <FormLancamento categorias={categorias ?? []} empresas={opcoesEmpresas} hoje={hoje} rotulo="Nova despesa" />
          </>
        }
      />
      {aClassificar ? (
        <Alerta
          tom="alerta"
          titulo={`${aClassificar} lançamento(s) a classificar`}
          acao={
            ver !== "classificar" ? (
              <Button asChild tamanho="sm" variante="contorno">
                <Link href={urlCom(base, sp, { ver: "classificar" })}>Classificar agora</Link>
              </Button>
            ) : null
          }
        >
          Sem a linha da DRE, eles não entram no resultado do escritório.
        </Alerta>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <nav className="flex flex-wrap gap-2" aria-label="Filtro">
          {(
            [
              ["todos", "Todos do mês"],
              ["receita", "Entradas"],
              ["despesa", "Saídas"],
              ["classificar", "A classificar"],
            ] as const
          ).map(([chave, rotulo]) => (
            <Button key={chave} asChild tamanho="sm" variante={ver === chave ? "secundario" : "fantasma"}>
              <Link href={urlCom(base, sp, { ver: chave === "todos" ? null : chave })}>{rotulo}</Link>
            </Button>
          ))}
        </nav>
        {ver !== "classificar" ? (
          <form action={base} className="ml-auto flex items-end gap-2">
            {ver !== "todos" ? <input type="hidden" name="ver" value={ver} /> : null}
            <Select name="mes" defaultValue={mes.slice(0, 7)} aria-label="Mês" className="w-44">
              {listaCompetencias(24, 0).map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" variante="contorno">
              Ver
            </Button>
          </form>
        ) : null}
      </div>

      {ver !== "classificar" ? (
        <p className="text-sm text-muted-foreground">
          {formatarCompetencia(mes, true)}: entradas <strong className="text-sucesso">{formatarMoeda(entradas)}</strong> · saídas <strong className="text-perigo">{formatarMoeda(saidas)}</strong>
        </p>
      ) : null}

      {lista.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <THead>
              <Tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Linha da DRE</Th>
                <Th className="text-right">Valor</Th>
                <Th className="w-1" />
              </Tr>
            </THead>
            <TBody>
              {lista.map((l) => {
                const cat = l.categoria as unknown as { codigo: string; nome: string } | null;
                return (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-sm">{formatarData(l.data)}</Td>
                    <Td className="max-w-96 text-sm">
                      {l.descricao}
                      {l.origem === "cobranca" ? <span className="block text-xs text-muted-foreground">da cobrança (baixa)</span> : null}
                    </Td>
                    <Td className="text-xs">{cat ? `${cat.codigo} ${cat.nome}` : <Badge variante="alerta">A classificar</Badge>}</Td>
                    <Td className={`whitespace-nowrap text-right font-medium ${l.natureza === "receita" ? "text-sucesso" : "text-perigo"}`}>
                      {l.natureza === "receita" ? "+" : "−"} {formatarMoeda(l.valor)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <FormLancamento categorias={categorias ?? []} empresas={opcoesEmpresas} hoje={hoje} lancamento={{ ...l, valor: Number(l.valor) }} />
                        {l.origem !== "cobranca" ? <ExcluirLancamento id={l.id} /> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio
          icone={ver === "classificar" ? FileQuestion : FileSpreadsheet}
          titulo={ver === "classificar" ? "Nada a classificar" : "Nenhum lançamento neste mês"}
          descricao={ver === "classificar" ? "Todos os lançamentos têm a linha da DRE." : "Os pagamentos das cobranças entram aqui sozinhos. Lance as despesas do escritório para ver o resultado."}
        />
      )}
    </div>
  );
}
