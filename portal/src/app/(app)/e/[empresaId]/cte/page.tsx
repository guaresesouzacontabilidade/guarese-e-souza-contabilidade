import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, PlugZap, Plus, Route, Settings2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { competenciaAtual, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { certificadoValido } from "@/lib/nfe-emissao/rotulos";
import { EM_ANDAMENTO_CTE, SITUACAO_CTE, type SituacaoCte } from "@/lib/cte-emissao/rotulos";

export const metadata: Metadata = { title: "CT-e (frete)" };

export default async function ListaCte({ params, searchParams }: PageProps<"/e/[empresaId]/cte">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const configurar = ctx.pode("cte.configurar");
  const emitir = ctx.pode("cte.emitir");
  if (!emitir && !configurar) return <Alerta tom="alerta">Seu acesso não inclui a emissão de CT-e desta empresa.</Alerta>;
  const base = `/e/${empresaId}/cte`;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? competenciaAtual();
  const fim = ultimoDiaDoMes(comp);

  const [{ data: cfg }, { data: lista0, error }, { data: cert }] = await Promise.all([
    ctx.supabase.from("cte_config").select("ativa, ambiente, rntrc, emitente_id").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase
      .from("cte_emissoes")
      .select("id, created_at, autorizada_em, numero, serie, tomador_nome, tomador_documento, municipio_inicio, uf_inicio, municipio_fim, uf_fim, valor_total, peso_kg, situacao, ambiente")
      .eq("empresa_id", empresaId)
      .gte("created_at", `${comp}T00:00:00-03:00`)
      .lte("created_at", `${fim}T23:59:59-03:00`)
      .order("created_at", { ascending: false })
      .limit(300),
    ctx.supabase.from("notas_automaticas").select("certificado_valido_ate").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar os CT-e: {mensagemErro(error)}</Alerta>;
  const lista = lista0 ?? [];
  const ativa = Boolean(cfg?.ativa);
  const producao = lista.filter((n) => n.ambiente === "producao");
  const autorizados = producao.filter((n) => n.situacao === "autorizada" || n.situacao === "cancelando");
  const total = autorizados.reduce((s, n) => s + Number(n.valor_total), 0);
  const andamento = lista.some((n) => EM_ANDAMENTO_CTE.includes(n.situacao as SituacaoCte));

  return (
    <>
      <CabecalhoPagina
        titulo="CT-e (frete)"
        descricao="Emita o conhecimento de transporte eletrônico do frete rodoviário: o portal calcula o ICMS e o IBS/CBS com as regras do escritório e envia à SEFAZ com o certificado digital."
        acoes={
          <>
            <SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês" />
            {configurar ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/configuracao`}>
                  <Settings2 /> Configurar emissão
                </Link>
              </Button>
            ) : null}
            {ativa && emitir ? (
              <Button asChild>
                <Link href={`${base}/nova`}>
                  <Plus /> Emitir CT-e
                </Link>
              </Button>
            ) : emitir && cfg?.rntrc && cfg.emitente_id ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/nova`}>
                  <Calculator /> Conferir um frete
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AtualizarEnquanto ativo={andamento} intervaloMs={3000} />

      {!ativa ? (
        <Alerta tom="alerta" className="mb-4" titulo="Emissão desconectada">
          {configurar ? (
            <>
              Para ligar a emissão de CT-e desta empresa:{" "}
              {certificadoValido(cert?.certificado_valido_ate) ? "certificado digital válido ✔" : "cadastre o certificado digital A1 em Notas automáticas"}; escolha o
              estabelecimento, informe o RNTRC e cadastre as operações do frete; registre a autorização do cliente e ligue a emissão em{" "}
              <Link href={`${base}/configuracao`} className="font-medium underline">
                Configurar emissão
              </Link>
              . A transportadora precisa estar credenciada na SEFAZ para emitir CT-e. Nenhum CT-e é enviado enquanto a emissão estiver desligada.
            </>
          ) : (
            "O escritório ainda não ligou a emissão de CT-e para a sua empresa (é preciso o certificado digital, o RNTRC e as regras do frete). Fale com o escritório."
          )}
        </Alerta>
      ) : cfg?.ambiente === "homologacao" ? (
        <Alerta tom="info" className="mb-4" titulo="Emissão em teste (homologação)">
          Os CT-e desta empresa saem no ambiente de testes da SEFAZ, sem valor fiscal. O escritório passa para produção depois de conferir.
        </Alerta>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="CT-e autorizados no mês" valor={autorizados.length} icone={Route} detalhe={producao.length !== lista.length ? "CT-e de teste não contam." : undefined} />
        <Indicador rotulo="Fretes autorizados" valor={formatarMoeda(total)} tom="sucesso" />
        <Indicador
          rotulo="Rejeitados, sem resposta ou cancelados"
          valor={lista.filter((n) => ["rejeitada", "denegada", "falha", "cancelada"].includes(n.situacao)).length}
          tom={lista.some((n) => ["rejeitada", "denegada", "falha"].includes(n.situacao)) ? "alerta" : "neutro"}
        />
      </div>

      <Card>
        <CardContent className="p-0 sm:p-0">
          {lista.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Número</Th>
                  <Th>Quem paga</Th>
                  <Th>Trajeto</Th>
                  <Th className="text-right">Frete</Th>
                  <Th>Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {lista.map((n) => {
                  const s = SITUACAO_CTE[n.situacao as SituacaoCte];
                  return (
                    <Tr key={n.id}>
                      <Td className="whitespace-nowrap">
                        <Link href={`${base}/${n.id}`} className="font-medium underline-offset-4 hover:underline">
                          {formatarDataHora(n.autorizada_em ?? n.created_at)}
                        </Link>
                      </Td>
                      <Td className="numero whitespace-nowrap">
                        {n.numero}
                        <span className="block text-xs text-muted-foreground">série {n.serie}</span>
                      </Td>
                      <Td>
                        {n.tomador_nome}
                        <span className="block text-xs text-muted-foreground">{formatarDocumento(n.tomador_documento)}</span>
                      </Td>
                      <Td className="text-sm">
                        {n.municipio_inicio}/{n.uf_inicio} → {n.municipio_fim}/{n.uf_fim}
                        {n.peso_kg != null ? (
                          <span className="block text-xs text-muted-foreground">{Number(n.peso_kg).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} kg</span>
                        ) : null}
                      </Td>
                      <Td className="text-right numero whitespace-nowrap">{formatarMoeda(n.valor_total)}</Td>
                      <Td>
                        <Badge variante={s.tom}>{s.rotulo}</Badge>
                        {n.ambiente === "homologacao" ? (
                          <Badge variante="contorno" className="ml-1">
                            teste
                          </Badge>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={PlugZap}
              titulo="Nenhum CT-e neste mês"
              descricao={ativa ? "Use “Emitir CT-e” para emitir o primeiro." : "Quando a emissão estiver ligada, os CT-e emitidos aparecem aqui."}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
