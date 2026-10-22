import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Receipt, ShoppingCart, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { hojeLocal, obterContextoLoja } from "@/lib/gestao/contexto";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Vendas e orçamentos" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;

const SITUACOES: Record<string, { rotulo: string; variante: "sucesso" | "perigo" | "info" | "neutro" }> = {
  concluida: { rotulo: "Concluída", variante: "sucesso" },
  cancelada: { rotulo: "Cancelada", variante: "perigo" },
  aberto: { rotulo: "Em aberto", variante: "info" },
  convertido: { rotulo: "Virou venda", variante: "neutro" },
};

export default async function PaginaVendas({ params, searchParams }: PageProps<"/e/[empresaId]/loja/vendas">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;

  const tipo = sp.tipo === "orcamento" ? "orcamento" : "venda";
  const hoje = hojeLocal();
  const inicio = typeof sp.de === "string" && DATA.test(sp.de) ? sp.de : hoje.slice(0, 8) + "01";
  const fim = typeof sp.ate === "string" && DATA.test(sp.ate) ? sp.ate : hoje;
  const status = typeof sp.status === "string" ? sp.status : "";
  const busca = typeof sp.q === "string" ? sp.q.trim() : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  let q = ctx.supabase
    .from("vendas")
    .select("id, numero, status, data, validade, cliente_nome, total, nfe_emissao_id, venda_pagamentos(forma, valor)", { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("tipo", tipo)
    .gte("data", inicio)
    .lte("data", fim)
    .order("numero", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (status) q = q.eq("status", status);
  if (busca) q = /^\d+$/.test(busca) ? q.eq("numero", Number(busca)) : q.ilike("cliente_nome", `%${busca.replace(/[%_]/g, "")}%`);

  const [{ data: vendas, count }, { data: periodo }] = await Promise.all([
    q,
    tipo === "venda"
      ? ctx.supabase
          .from("vendas")
          .select("total, venda_pagamentos(forma, valor)")
          .eq("empresa_id", empresaId)
          .eq("tipo", "venda")
          .eq("status", "concluida")
          .gte("data", inicio)
          .lte("data", fim)
          .limit(20000)
      : Promise.resolve({ data: [] as { total: number; venda_pagamentos: { forma: string; valor: number }[] }[] }),
  ]);
  const totalPeriodo = (periodo ?? []).reduce((s, v) => s.plus(dec(v.total)), dec(0));
  const prazo = (periodo ?? []).flatMap((v) => v.venda_pagamentos).filter((p) => p.forma === "a_prazo").reduce((s, p) => s.plus(dec(p.valor)), dec(0));
  const qtd = (periodo ?? []).length;
  const base = `/e/${empresaId}/loja/vendas`;

  return (
    <>
      <CabecalhoPagina
        titulo="Vendas e orçamentos"
        descricao="Todas as vendas do caixa e os orçamentos feitos para os clientes."
        acoes={
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/vender`}>
              <ShoppingCart /> Nova venda
            </Link>
          </Button>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="mb-4 flex gap-2">
        <Button asChild variante={tipo === "venda" ? "secundario" : "fantasma"} tamanho="sm">
          <Link href={urlCom(base, {}, { de: inicio, ate: fim })}>Vendas</Link>
        </Button>
        <Button asChild variante={tipo === "orcamento" ? "secundario" : "fantasma"} tamanho="sm">
          <Link href={urlCom(base, {}, { tipo: "orcamento", de: inicio, ate: fim })}>Orçamentos</Link>
        </Button>
      </div>
      {tipo === "venda" ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Vendido no período" valor={formatarMoeda(totalPeriodo)} detalhe={`${qtd} venda(s) concluída(s)`} icone={Receipt} />
          <Indicador rotulo="Média por venda" valor={formatarMoeda(qtd ? totalPeriodo.div(qtd) : 0)} icone={ShoppingCart} tom="info" />
          <Indicador rotulo="Vendido a prazo" valor={formatarMoeda(prazo)} detalhe="em contas a receber" icone={Wallet} tom="alerta" />
          <Indicador rotulo="À vista" valor={formatarMoeda(totalPeriodo.minus(prazo))} detalhe="dinheiro, PIX e cartão" icone={FileText} tom="sucesso" />
        </div>
      ) : null}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <form className="flex flex-wrap items-end gap-2" action={base}>
            {tipo === "orcamento" ? <input type="hidden" name="tipo" value="orcamento" /> : null}
            <label className="text-xs text-muted-foreground">
              De
              <Input type="date" name="de" defaultValue={inicio} className="mt-1 w-40" />
            </label>
            <label className="text-xs text-muted-foreground">
              Até
              <Input type="date" name="ate" defaultValue={fim} className="mt-1 w-40" />
            </label>
            <Select name="status" defaultValue={status} className="w-44" aria-label="Situação">
              <option value="">Todas as situações</option>
              {(tipo === "venda" ? ["concluida", "cancelada"] : ["aberto", "convertido", "cancelada"]).map((s) => (
                <option key={s} value={s}>
                  {SITUACOES[s].rotulo}
                </option>
              ))}
            </Select>
            <Input name="q" defaultValue={busca} placeholder="Número ou cliente" className="w-full sm:w-56" aria-label="Buscar" />
            <Button type="submit" variante="secundario">
              Filtrar
            </Button>
          </form>
          {(vendas ?? []).length ? (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Data</Th>
                    <Th>Cliente</Th>
                    <Th>{tipo === "venda" ? "Pagamento" : "Validade"}</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </THead>
                <TBody>
                  {(vendas ?? []).map((v) => {
                    const sit = SITUACOES[v.status];
                    return (
                      <Tr key={v.id}>
                        <Td className="font-semibold">
                          <Link href={`${base}/${v.id}`} className="hover:underline">
                            {v.numero}
                          </Link>
                        </Td>
                        <Td className="numero">{formatarData(v.data)}</Td>
                        <Td>{v.cliente_nome ?? "Consumidor"}</Td>
                        <Td className="text-xs">
                          {tipo === "venda"
                            ? [...new Set(v.venda_pagamentos.map((p) => FORMAS_PAGAMENTO[p.forma as FormaPagamento]))].join(" + ")
                            : formatarData(v.validade)}
                        </Td>
                        <Td>
                          <Badge variante={sit?.variante}>{sit?.rotulo ?? v.status}</Badge>
                          {v.nfe_emissao_id ? (
                            <Badge variante="info" className="ml-1">
                              NF-e
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="text-right font-medium numero">{formatarMoeda(v.total)}</Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
            </>
          ) : (
            <EstadoVazio icone={tipo === "venda" ? Receipt : FileText} titulo={tipo === "venda" ? "Nenhuma venda no período" : "Nenhum orçamento no período"} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
