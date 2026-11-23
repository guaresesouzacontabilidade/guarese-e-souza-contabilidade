import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, Plus, Search } from "lucide-react";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ListaParaConferir } from "@/components/honorarios/cobrancas";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { parametro, termoBusca } from "@/lib/busca";
import { hojeISO, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Cobranças de honorários" };

const FILTROS = { todas: "Todas", rascunho: "Para conferir", aberta: "Em aberto", vencida: "Vencidas", paga: "Pagas", cancelada: "Canceladas" } as const;

type Linha = { id: string; ano: number; numero: number; pagador_nome: string; descricao: string; valor: number; vencimento: string; situacao: string; tipo: string; pago_em: string | null; valor_pago: number | null };

export default async function Cobrancas({ searchParams }: PageProps<"/escritorio/honorarios/cobrancas">) {
  const s = await exigirHonorarios();
  const sp = await searchParams;
  const filtro = (parametro(sp, "situacao", Object.keys(FILTROS)) || "todas") as keyof typeof FILTROS;
  const mes = lerCompetencia(parametro(sp, "mes"));
  const busca = termoBusca(sp.busca);
  const hoje = hojeISO();

  let q = s.supabase
    .from("honorarios_cobrancas")
    .select("id, ano, numero, pagador_nome, descricao, valor, vencimento, situacao, tipo, pago_em, valor_pago")
    .order("vencimento", { ascending: filtro !== "paga" && filtro !== "todas" })
    .order("numero", { ascending: false })
    .limit(500);
  if (filtro === "vencida") q = q.eq("situacao", "aberta").lt("vencimento", hoje);
  else if (filtro !== "todas") q = q.eq("situacao", filtro);
  if (mes) q = q.gte("vencimento", mes).lte("vencimento", ultimoDiaDoMes(mes));
  if (busca) q = q.ilike("pagador_nome", `%${busca}%`);
  const { data } = await q;
  const linhas = (data ?? []) as Linha[];
  const base = "/escritorio/honorarios/cobrancas";

  const tabela = () => (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <THead>
          <Tr>
            <Th>Nº</Th>
            <Th>Cliente</Th>
            <Th>Referente a</Th>
            <Th className="text-right">Valor</Th>
            <Th>Vencimento</Th>
            <Th>Situação</Th>
          </Tr>
        </THead>
        <TBody>
          {linhas.map((c) => {
            const sit = situacaoExibida(c, hoje);
            return (
              <Tr key={c.id}>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">{numeroCobranca(c)}</Td>
                <Td>
                  <Link href={`${base}/${c.id}`} className="font-medium hover:text-primary hover:underline">
                    {c.pagador_nome}
                  </Link>
                </Td>
                <Td className="max-w-72 truncate text-sm">{c.descricao}</Td>
                <Td className="whitespace-nowrap text-right font-medium">{formatarMoeda(c.situacao === "paga" ? (c.valor_pago ?? c.valor) : c.valor)}</Td>
                <Td className="whitespace-nowrap text-sm">{c.situacao === "paga" ? `pago ${formatarData(c.pago_em)}` : formatarData(c.vencimento)}</Td>
                <Td>
                  <Badge variante={sit.tom === "neutro" ? "neutro" : sit.tom}>{sit.rotulo}</Badge>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo="Cobranças"
        descricao="Mensais (geradas pelas fichas dos clientes) e avulsas. As novas ficam “Para conferir” até você enviar."
        voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }}
        acoes={
          <Button asChild>
            <Link href={`${base}/nova`}>
              <Plus /> Nova cobrança avulsa
            </Link>
          </Button>
        }
      />

      <nav className="flex flex-wrap gap-2" aria-label="Situação">
        {Object.entries(FILTROS).map(([chave, rotulo]) => (
          <Button key={chave} asChild tamanho="sm" variante={filtro === chave ? "secundario" : "fantasma"}>
            <Link href={urlCom(base, sp, { situacao: chave === "todas" ? null : chave })} aria-current={filtro === chave ? "page" : undefined}>
              {rotulo}
            </Link>
          </Button>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-2" action={base}>
        {filtro !== "todas" ? <input type="hidden" name="situacao" value={filtro} /> : null}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar cliente" className="pl-9" aria-label="Buscar cliente" />
        </div>
        <Select name="mes" defaultValue={mes?.slice(0, 7) ?? ""} aria-label="Mês do vencimento" className="w-48">
          <option value="">Todos os meses</option>
          {listaCompetencias(18, 2).map((m) => (
            <option key={m.valor} value={m.valor}>
              Vence em {m.rotulo}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {linhas.length ? (
        <>
          <p className="text-sm text-muted-foreground">
            {linhas.length} cobrança(s) · total {formatarMoeda(somar(linhas.map((l) => (l.situacao === "paga" ? (l.valor_pago ?? l.valor) : l.valor))))}
          </p>
          {filtro === "rascunho" ? (
            <ListaParaConferir linhas={linhas.map((l) => ({ id: l.id, numero: numeroCobranca(l), pagador_nome: l.pagador_nome, descricao: l.descricao, valor: Number(l.valor), vencimento: l.vencimento }))} />
          ) : (
            tabela()
          )}
        </>
      ) : (
        <EstadoVazio
          icone={HandCoins}
          titulo="Nenhuma cobrança aqui"
          descricao={filtro === "rascunho" ? "Gere as cobranças do mês no painel dos honorários." : "Mude o filtro ou crie uma cobrança avulsa."}
        />
      )}
    </div>
  );
}
