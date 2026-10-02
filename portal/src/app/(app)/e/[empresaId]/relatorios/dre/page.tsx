import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown, FileSpreadsheet, X } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorPeriodo } from "@/components/relatorios/seletor-periodo";
import { carregarDre } from "@/lib/relatorios/dados";
import { lerPeriodo, opcoesPeriodo, rotuloMesCurto } from "@/lib/relatorios/periodo";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Resultado (DRE)" };
const UUID = /^[0-9a-f-]{36}$/i;

function Valor({ v, forte }: { v: string; forte?: boolean }) {
  const d = dec(v);
  return <span className={cn("numero whitespace-nowrap", d.isNegative() && "text-perigo", forte && "font-semibold", d.isZero() && "text-muted-foreground")}>{d.isZero() ? "—" : formatarMoeda(d)}</span>;
}

export default async function PaginaDre({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios/dre">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}/relatorios/publicados`);
  const hoje = hojeISO();
  const periodo = lerPeriodo(parametro(sp, "periodo"), hoje);
  const centro = UUID.test(parametro(sp, "centro")) ? parametro(sp, "centro") : "";
  const projeto = UUID.test(parametro(sp, "projeto")) ? parametro(sp, "projeto") : "";
  const detalhe = parametro(sp, "detalhe");

  const [dre, { data: centros }, { data: projetos }] = await Promise.all([
    carregarDre(ctx.supabase, empresaId, periodo.inicio, periodo.fim, { centro, projeto }),
    ctx.supabase.from("centros_custo").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("projetos").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
  ]);
  const varios = dre.meses.length > 1;
  const base = `/e/${empresaId}/relatorios/dre`;
  const linhaDetalhe = detalhe ? dre.linhas.find((l) => l.chave === detalhe && l.tipo !== "total") : null;
  const composicao = linhaDetalhe
    ? await ctx.supabase.rpc("relatorio_dre_composicao", {
        p_empresa_id: empresaId,
        p_inicio: periodo.inicio,
        p_fim: periodo.fim,
        p_tipos: linhaDetalhe.tipos ?? [],
        p_categoria_id: linhaDetalhe.categoria_id ?? undefined,
        p_centro_custo_id: centro || undefined,
      })
    : null;
  const exportar = (formato: string) =>
    urlCom("/api/relatorios/exportar", {}, { empresa: empresaId, tipo: "dre", periodo: periodo.chave, formato, centro: centro || null, projeto: projeto || null });
  const vazio = dre.linhas.every((l) => dec(l.total).isZero());

  return (
    <>
      <CabecalhoPagina
        titulo="Resultado do período (DRE)"
        descricao="Receitas, custos e despesas pela competência — quando a venda ou a despesa aconteceu, não quando foi paga. Clique em uma linha para ver os lançamentos que a compõem."
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("pdf")}>
                <FileDown /> PDF
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SeletorPeriodo valor={periodo.chave} opcoes={opcoesPeriodo(hoje)} />
        {(centros?.length || projetos?.length) ? (
          <form className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="periodo" value={periodo.chave} />
            {centros?.length ? (
              <Select name="centro" defaultValue={centro} aria-label="Centro de custo" className="w-full sm:w-52">
                <option value="">Todos os centros de custo</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            ) : null}
            {projetos?.length ? (
              <Select name="projeto" defaultValue={projeto} aria-label="Projeto" className="w-full sm:w-52">
                <option value="">Todos os projetos</option>
                {projetos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button type="submit" variante="contorno">
              Aplicar
            </Button>
          </form>
        ) : null}
      </div>

      {vazio ? (
        <EstadoVazio titulo="Sem receitas ou despesas confirmadas neste período" descricao="Lançamentos sugeridos (de XML ou leitura de documentos) só entram no resultado depois de confirmados." />
      ) : (
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <Th className="sticky left-0 z-10 min-w-64 bg-muted">Descrição</Th>
              {varios
                ? dre.meses.map((m) => (
                    <Th key={m} className="text-right">
                      {rotuloMesCurto(m)}
                    </Th>
                  ))
                : null}
              <Th className="text-right">{varios ? "Total" : periodo.rotulo}</Th>
              <Th className="text-right" title="Participação sobre a receita bruta">
                % receita
              </Th>
            </tr>
          </THead>
          <TBody>
            {dre.linhas.map((l) => {
              const href = l.tipo === "total" ? null : urlCom(base, sp, { detalhe: l.chave });
              const ativo = l.chave === detalhe;
              return (
                <Tr key={l.chave} className={cn(l.tipo === "total" && "bg-muted/60", l.destaque && "bg-bege/70", ativo && "bg-info-bg")}>
                  <Td
                    className={cn(
                      "sticky left-0 z-10",
                      ativo ? "bg-info-bg" : l.destaque ? "bg-bege" : l.tipo === "total" ? "bg-muted" : "bg-card",
                      l.nivel === 1 && "pl-8 text-sm",
                      l.tipo !== "categoria" && "font-semibold",
                      l.destaque && "text-titulo",
                    )}
                  >
                    {href ? (
                      <Link href={href} scroll={false} className="hover:underline">
                        {l.rotulo}
                      </Link>
                    ) : (
                      l.rotulo
                    )}
                  </Td>
                  {varios
                    ? dre.meses.map((m) => (
                        <Td key={m} className="text-right text-sm">
                          <Valor v={l.valores[m]} forte={l.tipo !== "categoria"} />
                        </Td>
                      ))
                    : null}
                  <Td className="text-right">
                    <Valor v={l.total} forte />
                  </Td>
                  <Td className="text-right text-sm text-muted-foreground numero">{l.percentual === null ? "" : `${l.percentual.toFixed(1).replace(".", ",")}%`}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      {linhaDetalhe ? (
        <section className="mt-6 space-y-2" id="detalhe" aria-labelledby="t-detalhe">
          <div className="flex items-center justify-between gap-2">
            <h2 id="t-detalhe" className="text-base font-semibold">
              Composição: {linhaDetalhe.rotulo}
            </h2>
            <Button asChild tamanho="sm" variante="fantasma">
              <Link href={urlCom(base, sp, { detalhe: null })} scroll={false}>
                <X /> Fechar
              </Link>
            </Button>
          </div>
          {composicao?.error ? (
            <Alerta tom="perigo">{composicao.error.message}</Alerta>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Data</Th>
                  <Th>Descrição</Th>
                  <Th>Cliente/Fornecedor</Th>
                  <Th>Categoria</Th>
                  <Th className="text-right">Valor</Th>
                </tr>
              </THead>
              <TBody>
                {(composicao?.data ?? []).map((c, i) => (
                  <Tr key={`${c.lancamento_id}-${c.baixa_id ?? ""}-${i}`}>
                    <Td className="whitespace-nowrap text-sm">{formatarData(c.data)}</Td>
                    <Td className="max-w-[18rem]">
                      {c.lancamento_id ? (
                        <Link href={`/e/${empresaId}/financeiro/lancamentos/${c.lancamento_id}`} className="block truncate hover:underline">
                          {c.descricao}
                        </Link>
                      ) : (
                        c.descricao
                      )}
                      {c.origem === "ajuste_baixa" ? <span className="text-xs text-muted-foreground">reconhecido na data do pagamento</span> : null}
                    </Td>
                    <Td className="max-w-[12rem] truncate text-sm">{c.contraparte ?? "—"}</Td>
                    <Td className="text-sm">{c.categoria_nome}</Td>
                    <Td className="whitespace-nowrap text-right numero">{formatarMoeda(c.valor)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        Juros, multas, descontos e taxas de pagamentos entram no mês em que foram pagos. Transferências entre contas, aportes, retiradas de sócios,
        empréstimos e investimentos não entram no resultado (aparecem no fluxo de caixa).
      </p>
    </>
  );
}
