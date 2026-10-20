import type { Metadata } from "next";
import Link from "next/link";
import { BookUser, FileText, PlugZap, Plus, Settings2 } from "lucide-react";
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
import { EM_ANDAMENTO, SITUACAO_NFE, certificadoValido, type SituacaoNfe } from "@/lib/nfe-emissao/rotulos";

export const metadata: Metadata = { title: "Notas de produto (NF-e)" };

export default async function NotasProduto({ params, searchParams }: PageProps<"/e/[empresaId]/notas-produto">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const configurar = ctx.pode("nfe.configurar");
  const emitir = ctx.pode("nfe.emitir");
  if (!emitir && !configurar) return <Alerta tom="alerta">Seu acesso não inclui a emissão de NF-e desta empresa.</Alerta>;
  const base = `/e/${empresaId}/notas-produto`;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? competenciaAtual();
  const fim = ultimoDiaDoMes(comp);

  const [{ data: cfg }, { data: notas, error }, { data: cert }, { count: guiasAGerar }] = await Promise.all([
    ctx.supabase.from("nfe_config").select("ativa, ambiente").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase
      .from("nfe_emissoes")
      .select("id, created_at, autorizada_em, numero, serie, destinatario_nome, destinatario_documento, destinatario_uf, valor_total, situacao, ambiente, natureza")
      .eq("empresa_id", empresaId)
      .gte("created_at", `${comp}T00:00:00-03:00`)
      .lte("created_at", `${fim}T23:59:59-03:00`)
      .order("created_at", { ascending: false })
      .limit(300),
    ctx.supabase.from("notas_automaticas").select("certificado_valido_ate").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("nfe_guias").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("situacao", "a_gerar"),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as notas: {mensagemErro(error)}</Alerta>;
  const lista = notas ?? [];
  const ativa = Boolean(cfg?.ativa);
  const producao = lista.filter((n) => n.ambiente === "producao");
  const autorizadas = producao.filter((n) => n.situacao === "autorizada" || n.situacao === "cancelando");
  const total = autorizadas.reduce((s, n) => s + Number(n.valor_total), 0);
  const andamento = lista.some((n) => EM_ANDAMENTO.includes(n.situacao as SituacaoNfe));

  return (
    <>
      <CabecalhoPagina
        titulo="Notas de produto (NF-e)"
        descricao="Emita a nota fiscal eletrônica de venda (empresa ou produtor rural): o portal calcula os impostos com as regras do escritório e envia à SEFAZ com o certificado digital."
        acoes={
          <>
            <SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês" />
            <Button asChild variante="contorno">
              <Link href={`${base}/cadastros`}>
                <BookUser /> Clientes e transportadores
              </Link>
            </Button>
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
                  <Plus /> Emitir NF-e
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
              Para ligar a emissão de NF-e desta empresa:{" "}
              {certificadoValido(cert?.certificado_valido_ate) ? "certificado digital válido ✔" : "cadastre o certificado digital A1 em Notas automáticas"}; cadastre a inscrição
              estadual (série), as operações e os produtos; registre a autorização do cliente e ligue a emissão em{" "}
              <Link href={`${base}/configuracao`} className="font-medium underline">
                Configurar emissão
              </Link>
              . A empresa precisa estar credenciada na SEFAZ do estado para emitir NF-e. Nenhuma nota é enviada enquanto a emissão estiver desligada.
            </>
          ) : (
            "O escritório ainda não ligou a emissão de NF-e para a sua empresa (é preciso o certificado digital e o cadastro das operações e produtos). Fale com o escritório."
          )}
        </Alerta>
      ) : cfg?.ambiente === "homologacao" ? (
        <Alerta tom="info" className="mb-4" titulo="Emissão em teste (homologação)">
          As notas desta empresa saem no ambiente de testes da SEFAZ, sem valor fiscal. O escritório passa para produção depois de conferir.
        </Alerta>
      ) : null}

      {configurar && guiasAGerar ? (
        <Alerta tom="alerta" className="mb-4" titulo={`${guiasAGerar} guia(s) a gerar`}>
          Há notas autorizadas com ICMS, frete, DIFAL ou contribuição a pagar. Abra a nota, gere a guia no site oficial e anexe o PDF (ela vai para a agenda de pagamentos do cliente).
        </Alerta>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Notas autorizadas no mês" valor={autorizadas.length} icone={FileText} detalhe={producao.length !== lista.length ? "Notas de teste não contam." : undefined} />
        <Indicador rotulo="Valor autorizado" valor={formatarMoeda(total)} tom="sucesso" />
        <Indicador
          rotulo="Rejeitadas, sem resposta ou canceladas"
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
                  <Th>Cliente</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {lista.map((n) => {
                  const s = SITUACAO_NFE[n.situacao as SituacaoNfe];
                  return (
                    <Tr key={n.id}>
                      <Td className="whitespace-nowrap">
                        <Link href={`${base}/${n.id}`} className="font-medium underline-offset-4 hover:underline">
                          {formatarDataHora(n.autorizada_em ?? n.created_at)}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{n.natureza}</span>
                      </Td>
                      <Td className="numero whitespace-nowrap">
                        {n.numero}
                        <span className="block text-xs text-muted-foreground">série {n.serie}</span>
                      </Td>
                      <Td>
                        {n.destinatario_nome}
                        <span className="block text-xs text-muted-foreground">
                          {formatarDocumento(n.destinatario_documento)}
                          {n.destinatario_uf ? ` — ${n.destinatario_uf}` : ""}
                        </span>
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
              titulo="Nenhuma NF-e neste mês"
              descricao={ativa ? "Use “Emitir NF-e” para emitir a primeira." : "Quando a emissão estiver ligada, as notas emitidas aparecem aqui."}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
