import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2, Plus, Scale, Truck, Wheat } from "lucide-react";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { CarregamentosIndisponivel, NavegacaoCarregamentos } from "@/components/loja/navegacao-loja";
import { hojeLocal, obterContextoLoja } from "@/lib/gestao/contexto";
import { STATUS_ORDEM, formatarKg, mostrarPlaca, type StatusOrdem } from "@/lib/gestao/carregamentos";
import { formatarQuantidade } from "@/lib/gestao/rotulos";
import { dec } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Ordens de carregamento" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;

export default async function PaginaCarregamentos({ params, searchParams }: PageProps<"/e/[empresaId]/loja/carregamentos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.carrega) return <CarregamentosIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const hoje = hojeLocal();
  const inicio = typeof sp.de === "string" && DATA.test(sp.de) ? sp.de : hoje.slice(0, 8) + "01";
  const fim = typeof sp.ate === "string" && DATA.test(sp.ate) ? sp.ate : hoje;
  const status = typeof sp.status === "string" && sp.status in STATUS_ORDEM ? (sp.status as StatusOrdem) : "";
  const busca = typeof sp.q === "string" ? sp.q.trim() : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  let q = ctx.supabase
    .from("ordens_carregamento")
    .select(
      "id, numero, status, data_emissao, destinatario_nome, produto_descricao, unidade, quantidade, peso_liquido_kg, placa, motorista_nome, nota:nfe_emissoes(numero, situacao)",
      {
        count: "exact",
      },
    )
    .eq("empresa_id", empresaId)
    .gte("data_emissao", inicio)
    .lte("data_emissao", fim)
    .order("numero", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (status) q = q.eq("status", status);
  if (busca) {
    const limpa = busca.replace(/[%_,()]/g, "");
    q = /^\d+$/.test(busca)
      ? q.eq("numero", Number(busca))
      : q.or(`destinatario_nome.ilike.%${limpa}%,placa.ilike.%${limpa.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`);
  }

  const [{ data: ordens, count }, { data: pendentes }, { data: periodo }] = await Promise.all([
    q,
    // Pendências não dependem do período: o que está esperando caminhão ou nota agora
    ctx.supabase.from("ordens_carregamento").select("status").eq("empresa_id", empresaId).in("status", ["aberta", "carregada"]).limit(5000),
    ctx.supabase
      .from("ordens_carregamento")
      .select("status, peso_liquido_kg")
      .eq("empresa_id", empresaId)
      .in("status", ["carregada", "faturada"])
      .gte("data_emissao", inicio)
      .lte("data_emissao", fim)
      .limit(20000),
  ]);
  const abertas = (pendentes ?? []).filter((o) => o.status === "aberta").length;
  const semNota = (pendentes ?? []).filter((o) => o.status === "carregada").length;
  const pesoPeriodo = (periodo ?? []).reduce((s, o) => s.plus(dec(o.peso_liquido_kg ?? 0)), dec(0));
  const faturadas = (periodo ?? []).filter((o) => o.status === "faturada").length;
  const base = `/e/${empresaId}/loja/carregamentos`;

  return (
    <>
      <CabecalhoPagina
        titulo="Ordens de carregamento"
        descricao="Autorize cada caminhão a carregar, registre a pesagem e emita a NF-e já preenchida com o peso da balança."
        acoes={
          <Button asChild>
            <Link href={`${base}/nova`}>
              <Plus /> Nova ordem
            </Link>
          </Button>
        }
      />
      <NavegacaoCarregamentos empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Aguardando carregar"
          valor={String(abertas)}
          detalhe="ordens abertas"
          icone={Truck}
          tom="info"
          href={urlCom(base, {}, { status: "aberta", de: "2000-01-01" })}
        />
        <Indicador
          rotulo="Carregadas sem NF-e"
          valor={String(semNota)}
          detalhe="emita a nota antes de o caminhão sair"
          icone={Scale}
          tom={semNota ? "alerta" : "neutro"}
          href={urlCom(base, {}, { status: "carregada", de: "2000-01-01" })}
        />
        <Indicador rotulo="Carregado no período" valor={`${formatarQuantidade(pesoPeriodo.div(1000), 3)} t`} detalhe={formatarKg(pesoPeriodo)} icone={Wheat} />
        <Indicador rotulo="Com NF-e no período" valor={String(faturadas)} detalhe="ordens faturadas" icone={FileCheck2} tom="sucesso" />
      </div>
      <Card>
        <CardContent className="space-y-4 pt-5">
          <form className="flex flex-wrap items-end gap-2" action={base}>
            <label className="text-xs text-muted-foreground">
              De
              <Input type="date" name="de" defaultValue={inicio} className="mt-1 w-40" />
            </label>
            <label className="text-xs text-muted-foreground">
              Até
              <Input type="date" name="ate" defaultValue={fim} className="mt-1 w-40" />
            </label>
            <Select name="status" defaultValue={status} className="w-52" aria-label="Situação">
              <option value="">Todas as situações</option>
              {Object.entries(STATUS_ORDEM).map(([v, s]) => (
                <option key={v} value={v}>
                  {s.rotulo}
                </option>
              ))}
            </Select>
            <Input name="q" defaultValue={busca} placeholder="Número, comprador ou placa" className="w-full sm:w-64" aria-label="Buscar" />
            <Button type="submit" variante="secundario">
              Filtrar
            </Button>
          </form>
          {(ordens ?? []).length ? (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Data</Th>
                    <Th>Comprador</Th>
                    <Th>Produto</Th>
                    <Th>Caminhão</Th>
                    <Th className="text-right">Peso líquido</Th>
                    <Th>Situação</Th>
                  </tr>
                </THead>
                <TBody>
                  {(ordens ?? []).map((o) => {
                    const st = STATUS_ORDEM[o.status as StatusOrdem];
                    const nota = o.nota as {
                      numero: number;
                      situacao: string;
                    } | null;
                    return (
                      <Tr key={o.id} className={o.status === "cancelada" ? "opacity-60" : undefined}>
                        <Td className="font-semibold">
                          <Link href={`${base}/${o.id}`} className="hover:underline">
                            {o.numero}
                          </Link>
                        </Td>
                        <Td className="numero">{formatarData(o.data_emissao)}</Td>
                        <Td>{o.destinatario_nome}</Td>
                        <Td>
                          {o.produto_descricao}
                          <span className="block text-xs text-muted-foreground">
                            previsto {formatarQuantidade(o.quantidade)} {o.unidade}
                          </span>
                        </Td>
                        <Td className="text-xs">
                          <span className="font-medium numero">{mostrarPlaca(o.placa)}</span>
                          {o.motorista_nome ? <span className="block text-muted-foreground">{o.motorista_nome}</span> : null}
                        </Td>
                        <Td className="whitespace-nowrap text-right numero">{o.peso_liquido_kg != null ? formatarKg(o.peso_liquido_kg) : "—"}</Td>
                        <Td>
                          <Badge variante={st?.variante}>{st?.rotulo ?? o.status}</Badge>
                          {nota ? <span className="block text-xs text-muted-foreground">NF-e nº {nota.numero}</span> : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <Paginacao
                pagina={pagina}
                totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)}
                total={count ?? 0}
                montarHref={(p) => urlCom(base, sp, { pagina: p })}
              />
            </>
          ) : (
            <EstadoVazio
              icone={Truck}
              titulo="Nenhuma ordem no período"
              descricao="Crie a ordem quando o comprador mandar o caminhão: ela sai impressa para o motorista e para o armazém."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
