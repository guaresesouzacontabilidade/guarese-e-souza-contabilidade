import type { Metadata } from "next";
import Link from "next/link";
import { FileCode2, Search } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDocumento } from "@/lib/formatos";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Notas fiscais" };
const POR_PAGINA = 50;

export default async function NotasFiscais({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/notas">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const operacao = parametro(sp, "operacao", ["entrada", "saida", "nao_relacionada"]);
  const busca = termoBusca(sp.busca);
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const base = `/e/${empresaId}/financeiro/notas`;

  let q = ctx.supabase
    .from("documentos_fiscais")
    .select(
      "id, documento_id, tipo_documento, modelo, numero, serie, data_emissao, operacao, emitente_nome, emitente_documento, destinatario_nome, destinatario_documento, valor_total, situacao_arquivo, cancelada_evento, chave_acesso",
      { count: "exact" },
    )
    .eq("empresa_id", empresaId)
    .eq("competencia", comp)
    .order("data_emissao", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (operacao) q = q.eq("operacao", operacao);
  if (busca) {
    const dig = busca.replace(/\D/g, "");
    q = dig.length >= 3 ? q.or(`numero.ilike.%${dig}%,chave_acesso.ilike.%${dig}%,emitente_documento.ilike.%${dig}%,destinatario_documento.ilike.%${dig}%`) : q.or(`emitente_nome.ilike.%${busca}%,destinatario_nome.ilike.%${busca}%`);
  }
  const [{ data, count }, todas] = await Promise.all([
    q,
    buscarTudo((de, ate) => ctx.supabase.from("documentos_fiscais").select("id, operacao, valor_total, cancelada_evento").eq("empresa_id", empresaId).eq("competencia", comp).range(de, ate)),
  ]);
  const ids = (data ?? []).map((n) => n.id);
  const { data: lancs } = ids.length
    ? await ctx.supabase.from("lancamentos").select("id, documento_fiscal_id, status_revisao, situacao").in("documento_fiscal_id", ids).neq("situacao", "cancelado")
    : { data: [] as { id: string; documento_fiscal_id: string | null; status_revisao: string; situacao: string }[] };
  const porNota = new Map<string, { confirmados: number; sugeridos: number; primeiro: string }>();
  for (const l of lancs ?? []) {
    if (!l.documento_fiscal_id) continue;
    const x = porNota.get(l.documento_fiscal_id) ?? { confirmados: 0, sugeridos: 0, primeiro: l.id };
    if (l.status_revisao === "confirmado") x.confirmados++;
    else x.sugeridos++;
    porNota.set(l.documento_fiscal_id, x);
  }
  const validas = todas.filter((n) => !n.cancelada_evento);
  const totSaida = somar(validas.filter((n) => n.operacao === "saida").map((n) => n.valor_total));
  const totEntrada = somar(validas.filter((n) => n.operacao === "entrada").map((n) => n.valor_total));
  const canceladas = todas.filter((n) => n.cancelada_evento).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Notas fiscais lidas dos XMLs"
        descricao="NF-e, NFC-e, CT-e e NFS-e registradas a partir dos arquivos enviados. Cada nota (pela chave de acesso) é registrada uma única vez."
      />
      <Alerta tom="info" className="mb-4">
        Os dados vêm do conteúdo dos arquivos. O portal não consulta a SEFAZ nem atesta a regularidade fiscal das notas. Lançamentos criados a partir de notas ficam
        como “sugeridos” até a revisão.
      </Alerta>
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Número, chave, CNPJ ou nome" className="pl-9" aria-label="Buscar nota" />
        </div>
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Competência">
          {listaCompetencias(36, 1).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="operacao" defaultValue={operacao} aria-label="Operação">
          <option value="">Entradas e saídas</option>
          <option value="saida">Saídas (emitidas)</option>
          <option value="entrada">Entradas (recebidas)</option>
          <option value="nao_relacionada">Não relacionadas à empresa</option>
        </Select>
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Notas em {formatarCompetencia(comp)}</p>
          <p className="font-semibold numero">{todas.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total de saídas (sem canceladas)</p>
          <p className="font-semibold numero">{formatarMoeda(totSaida)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total de entradas (sem canceladas)</p>
          <p className="font-semibold numero">{formatarMoeda(totEntrada)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Canceladas por evento</p>
          <p className="font-semibold numero">{canceladas}</p>
        </div>
      </div>
      {data?.length ? (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Nota</Th>
                <Th>Emissão</Th>
                <Th>{operacao === "entrada" ? "Emitente" : "Emitente / destinatário"}</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
                <Th>Financeiro</Th>
              </tr>
            </THead>
            <TBody>
              {data.map((n) => {
                const fin = porNota.get(n.id);
                const outro = n.operacao === "saida" ? { nome: n.destinatario_nome, doc: n.destinatario_documento } : { nome: n.emitente_nome, doc: n.emitente_documento };
                return (
                  <Tr key={n.id}>
                    <Td>
                      <Link href={`/e/${empresaId}/documentos/${n.documento_id}`} className="font-medium hover:underline">
                        {n.tipo_documento} {n.numero ? `nº ${n.numero}` : ""}
                        {n.serie ? `/${n.serie}` : ""}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{n.operacao === "saida" ? "Saída" : n.operacao === "entrada" ? "Entrada" : "Não relacionada"}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{formatarData(n.data_emissao)}</Td>
                    <Td className="max-w-[18rem]">
                      <span className="block truncate text-sm">{outro.nome ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{outro.doc ? formatarDocumento(outro.doc) : ""}</span>
                    </Td>
                    <Td className={n.cancelada_evento ? "text-right text-muted-foreground line-through numero" : "text-right numero"}>{formatarMoeda(n.valor_total)}</Td>
                    <Td>
                      {n.cancelada_evento ? (
                        <Badge variante="perigo">Cancelada (evento)</Badge>
                      ) : n.situacao_arquivo === "protocolo_autorizacao_no_arquivo" ? (
                        <Badge variante="sucesso">Com protocolo no arquivo</Badge>
                      ) : (
                        <Badge variante="alerta">Sem protocolo no arquivo</Badge>
                      )}
                    </Td>
                    <Td>
                      {fin ? (
                        <Link href={`/e/${empresaId}/financeiro/lancamentos/${fin.primeiro}`} className="hover:underline">
                          {fin.confirmados ? <Badge variante="sucesso">{fin.confirmados} confirmado(s)</Badge> : null}
                          {fin.sugeridos ? <Badge variante="alerta">{fin.sugeridos} sugerido(s)</Badge> : null}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem lançamento</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio icone={FileCode2} titulo="Nenhuma nota nesta competência" descricao="As notas aparecem aqui quando os XMLs (ou ZIPs com XMLs) são enviados em “Enviar documentos”." />
      )}
    </>
  );
}
