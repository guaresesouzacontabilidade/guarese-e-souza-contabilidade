import type { Metadata } from "next";
import Link from "next/link";
import { Download, Eye, Info, ReceiptText, Search, ShieldCheck, ShieldOff, Wallet } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NovoRecibo, type EmpresaRecibo } from "@/components/recibos/novo-recibo";
import { AssinarRecibo, CancelarRecibo, PublicarRecibo } from "@/components/recibos/acoes-recibo";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDocumento } from "@/lib/formatos";
import { numeroRecibo } from "@/lib/recibos/comum";
import { certificadoDoEscritorio, nomeDoTitular } from "@/lib/recibos/arquivo";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Recibos de honorários" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Recibos({ searchParams }: PageProps<"/escritorio/recibos">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const anoAtual = Number(hoje.slice(0, 4));
  const ano = Number(parametro(sp, "ano")) || anoAtual;
  const busca = termoBusca(sp.busca);
  const emitido = parametro(sp, "emitido");
  const avisos = [sp.aviso].flat().filter((a): a is string => typeof a === "string");
  const empresaInicial = parametro(sp, "empresa");

  let consulta = s.supabase
    .from("recibos_honorarios")
    .select("id, ano, numero, empresa_id, pagador_nome, pagador_documento, valor, referencia, competencia, data_recibo, situacao, motivo_cancelamento, documento_id, nfse_numero, arquivo_path")
    .eq("ano", ano)
    .order("numero", { ascending: false })
    .limit(1000);
  if (busca) consulta = consulta.ilike("pagador_nome", `%${busca}%`);

  const [{ data: lista, error }, empresas, { data: ultimos }, { data: anos }, { data: novo }, certificado] = await Promise.all([
    consulta,
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social").range(de, ate)),
    s.supabase
      .from("recibos_honorarios")
      .select("empresa_id, valor")
      .not("empresa_id", "is", null)
      .eq("situacao", "emitido")
      .order("data_recibo", { ascending: false })
      .order("numero", { ascending: false })
      .limit(2000),
    s.supabase.from("recibos_honorarios").select("ano").order("ano", { ascending: false }).limit(5000),
    UUID.test(emitido)
      ? s.supabase.from("recibos_honorarios").select("id, ano, numero, pagador_nome, documento_id, empresa_id, arquivo_path").eq("id", emitido).maybeSingle()
      : Promise.resolve({ data: null }),
    certificadoDoEscritorio(s.supabase),
  ]);
  const podeAssinar = Boolean(certificado && new Date(certificado.valido_ate) > new Date());
  if (error) return <Alerta tom="perigo">Não foi possível carregar os recibos: {error.message}</Alerta>;

  // Último valor de cada empresa, para o novo recibo já vir preenchido
  const ultimoValor = new Map<string, number>();
  for (const u of ultimos ?? []) if (u.empresa_id && !ultimoValor.has(u.empresa_id)) ultimoValor.set(u.empresa_id, u.valor);
  const opcoes: EmpresaRecibo[] = empresas
    .map((e) => ({ id: e.id, nome: e.nome_fantasia || e.razao_social, ultimoValor: ultimoValor.get(e.id) ?? null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const listaAnos = [...new Set([anoAtual, ...(anos ?? []).map((a) => a.ano)])].sort((a, b) => b - a);

  const recibos = lista ?? [];
  const validos = recibos.filter((r) => r.situacao === "emitido");
  const total = somar(validos.map((r) => r.valor));
  const publicados = validos.filter((r) => r.documento_id).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Recibos de honorários"
        descricao="Emita o recibo de pagamento dos honorários com o timbre do escritório, baixe em PDF e, se quiser, publique para o cliente."
        acoes={<NovoRecibo key={emitido || "novo"} empresas={opcoes} hoje={hoje} empresaInicial={empresaInicial} />}
      />

      {novo ? (
        <Alerta tom={avisos.length ? "alerta" : "sucesso"} className="mb-4" titulo={`Recibo nº ${numeroRecibo(novo)} emitido${novo.arquivo_path ? " e assinado digitalmente" : ""}`}>
          <p>
            Pagador: {novo.pagador_nome}.{novo.documento_id ? " O PDF já está nos documentos da empresa, em “Recibos”." : ""}
            {avisos.includes("assinatura") ? " Atenção: não foi possível assinar agora; use o botão “Assinar” na lista." : ""}
            {avisos.includes("publicar") ? " Atenção: não foi publicado para o cliente; tente de novo pelo botão “Publicar para o cliente” na lista." : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild tamanho="sm">
              <a href={`/api/recibos/${novo.id}/pdf`}>
                <Download /> Baixar o PDF
              </a>
            </Button>
            <Button asChild tamanho="sm" variante="contorno">
              <a href={`/api/recibos/${novo.id}/pdf?ver=1`} target="_blank" rel="noopener">
                <Eye /> Ver
              </a>
            </Button>
          </div>
        </Alerta>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*]:min-w-0">
        <Indicador rotulo={`Recibos de ${ano}`} valor={validos.length} icone={ReceiptText} detalhe={busca ? "na busca" : undefined} />
        <Indicador rotulo={`Total recebido em ${ano}`} valor={formatarMoeda(total)} icone={Wallet} detalhe="sem os cancelados" />
        <Indicador rotulo="Publicados para o cliente" valor={publicados} icone={Download} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="mb-4 space-y-1.5 text-xs text-muted-foreground">
        {podeAssinar ? (
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-sucesso" />
            <span>
              Os recibos saem <span className="font-medium text-foreground">assinados digitalmente</span> por {nomeDoTitular(certificado!.titular)} (certificado ICP-Brasil,
              válido até {formatarData(certificado!.valido_ate.slice(0, 10))}). Confira qualquer um em validar.iti.gov.br.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2">
            <ShieldOff className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {certificado ? "O certificado do escritório venceu: os" : "Os"} recibos saem sem assinatura digital. Para assinar automaticamente, o administrador cadastra o
              certificado A1 do escritório em{" "}
              <Link href="/escritorio/configuracoes?aba=integracoes" className="text-primary hover:underline">
                Configurações › Integrações
              </Link>
              .
            </span>
          </p>
        )}
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          O recibo comprova que o cliente pagou. Ele não substitui a nota fiscal de serviço (NFS-e) do escritório.
        </p>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Select name="ano" defaultValue={String(ano)} aria-label="Ano" className="w-full sm:w-32">
          {listaAnos.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar pagador" className="pl-9" aria-label="Buscar pagador" />
        </div>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {recibos.length ? (
        <>
          {/* Celular: um cartão por recibo, com os botões à vista */}
          <ul className="space-y-3 md:hidden">
            {recibos.map((r) => {
              const numero = numeroRecibo(r);
              const cancelado = r.situacao === "cancelado";
              return (
                <li key={r.id} className={cn("rounded-2xl border border-border bg-card p-4 shadow-[var(--sombra-card)]", cancelado && "opacity-70")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="numero text-sm font-semibold">
                        Nº {numero} · {formatarData(r.data_recibo)}
                      </p>
                      <p className="truncate font-medium">{r.pagador_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.referencia}
                        {r.competencia ? ` · ${formatarCompetencia(r.competencia, true)}` : ""}
                        {r.nfse_numero ? ` · NFS-e ${r.nfse_numero}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="numero font-semibold">{formatarMoeda(r.valor)}</p>
                      <SituacaoRecibo situacao={r.situacao} publicado={Boolean(r.documento_id)} assinado={Boolean(r.arquivo_path)} />
                    </div>
                  </div>
                  {cancelado && r.motivo_cancelamento ? <p className="mt-2 text-xs text-muted-foreground">Motivo: {r.motivo_cancelamento}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild variante="contorno" tamanho="sm">
                      <a href={`/api/recibos/${r.id}/pdf`} aria-label={`Baixar o PDF do recibo ${numero}`}>
                        <Download /> PDF
                      </a>
                    </Button>
                    {!cancelado && podeAssinar && !r.arquivo_path ? <AssinarRecibo reciboId={r.id} /> : null}
                    {!cancelado && r.empresa_id && !r.documento_id ? <PublicarRecibo reciboId={r.id} /> : null}
                    {!cancelado ? <CancelarRecibo reciboId={r.id} numero={numero} publicado={Boolean(r.documento_id)} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Data</Th>
                  <Th>Pagador</Th>
                  <Th>Referente a</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </THead>
              <TBody>
                {recibos.map((r) => {
                  const numero = numeroRecibo(r);
                  const cancelado = r.situacao === "cancelado";
                  return (
                    <Tr key={r.id} className={cancelado ? "opacity-70" : undefined}>
                      <Td className="numero whitespace-nowrap font-medium">{numero}</Td>
                      <Td className="whitespace-nowrap">{formatarData(r.data_recibo)}</Td>
                      <Td className="max-w-[16rem]">
                        {r.empresa_id ? (
                          <Link href={`/e/${r.empresa_id}`} className="block truncate font-medium hover:underline" title={r.pagador_nome}>
                            {r.pagador_nome}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium" title={r.pagador_nome}>
                            {r.pagador_nome}
                          </span>
                        )}
                        {r.pagador_documento ? <p className="text-xs text-muted-foreground">{formatarDocumento(r.pagador_documento)}</p> : null}
                      </Td>
                      <Td className="max-w-[14rem]">
                        <span className="block truncate">{r.referencia}</span>
                        <p className="text-xs text-muted-foreground">
                          {r.competencia ? formatarCompetencia(r.competencia, true) : "sem mês"}
                          {r.nfse_numero ? ` · NFS-e ${r.nfse_numero}` : ""}
                        </p>
                      </Td>
                      <Td className="numero whitespace-nowrap text-right font-medium">{formatarMoeda(r.valor)}</Td>
                      <Td>
                        <SituacaoRecibo situacao={r.situacao} publicado={Boolean(r.documento_id)} assinado={Boolean(r.arquivo_path)} />
                        {cancelado && r.motivo_cancelamento ? <p className="mt-1 max-w-[12rem] text-xs text-muted-foreground">{r.motivo_cancelamento}</p> : null}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button asChild variante="contorno" tamanho="sm">
                            <a href={`/api/recibos/${r.id}/pdf`} aria-label={`Baixar o PDF do recibo ${numero}`}>
                              <Download /> PDF
                            </a>
                          </Button>
                          {!cancelado && podeAssinar && !r.arquivo_path ? <AssinarRecibo reciboId={r.id} /> : null}
                          {!cancelado && r.empresa_id && !r.documento_id ? <PublicarRecibo reciboId={r.id} /> : null}
                          {!cancelado ? <CancelarRecibo reciboId={r.id} numero={numero} publicado={Boolean(r.documento_id)} /> : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </>
      ) : (
        <EstadoVazio
          icone={ReceiptText}
          titulo={busca ? "Nenhum recibo encontrado" : `Nenhum recibo em ${ano}`}
          descricao={busca ? "Tente outro nome ou outro ano." : "Clique em “Novo recibo” para emitir o primeiro."}
        />
      )}
    </>
  );
}

function SituacaoRecibo({ situacao, publicado, assinado }: { situacao: string; publicado: boolean; assinado: boolean }) {
  if (situacao === "cancelado") return <Badge variante="perigo">Cancelado</Badge>;
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {publicado ? <Badge variante="sucesso">Publicado</Badge> : <Badge variante="neutro">Emitido</Badge>}
      {assinado ? (
        <Badge variante="info" title="Assinado digitalmente (ICP-Brasil)">
          <ShieldCheck className="size-3" /> Assinado
        </Badge>
      ) : null}
    </span>
  );
}
