import type { Metadata } from "next";
import Link from "next/link";
import { FileText, PlugZap, Plus, Settings2 } from "lucide-react";
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
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { EM_ANDAMENTO, SITUACAO_NFSE, certificadoValido, type SituacaoNfse } from "@/lib/nfse-emissao/rotulos";

export const metadata: Metadata = { title: "Notas de serviço" };

export default async function NotasServico({ params, searchParams }: PageProps<"/e/[empresaId]/notas-servico">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const configurar = ctx.pode("nfse.configurar");
  if (!ctx.pode("nfse.emitir") && !configurar) return <Alerta tom="alerta">Seu acesso não inclui a emissão de notas desta empresa.</Alerta>;
  const base = `/e/${empresaId}/notas-servico`;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? competenciaAtual();
  const fim = ultimoDiaDoMes(comp);

  const [{ data: cfg }, { data: notas, error }, { count: servicos }, { data: cert }] = await Promise.all([
    ctx.supabase.from("nfse_emissao_config").select("ativa, ambiente").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase
      .from("nfse_emissoes")
      .select("id, created_at, competencia, numero_nfse, numero_dps, tomador_tipo, tomador_nome, tomador_documento, valor, situacao, ambiente")
      .eq("empresa_id", empresaId)
      .gte("competencia", comp)
      .lte("competencia", fim)
      .order("created_at", { ascending: false })
      .limit(300),
    ctx.supabase.from("nfse_servicos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true),
    ctx.supabase.from("notas_automaticas").select("certificado_valido_ate").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as notas: {mensagemErro(error)}</Alerta>;
  const lista = notas ?? [];
  const ativa = Boolean(cfg?.ativa);
  const producao = lista.filter((n) => n.ambiente === "producao");
  const emitidas = producao.filter((n) => n.situacao === "autorizada" || n.situacao === "cancelando");
  const total = emitidas.reduce((s, n) => s + Number(n.valor), 0);
  const andamento = lista.some((n) => EM_ANDAMENTO.includes(n.situacao as SituacaoNfse));
  const certificadoOk = certificadoValido(cert?.certificado_valido_ate);

  return (
    <>
      <CabecalhoPagina
        titulo="Notas de serviço"
        descricao="Emita a nota fiscal de serviço (NFS-e) pelo portal: ela sai na hora pelo Emissor Nacional, com o certificado digital da empresa."
        acoes={
          <>
            <SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês da prestação" />
            {configurar ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/configuracao`}>
                  <Settings2 /> Configurar emissão
                </Link>
              </Button>
            ) : null}
            {ativa && ctx.pode("nfse.emitir") ? (
              <Button asChild>
                <Link href={`${base}/nova`}>
                  <Plus /> Emitir nota
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
              Para ligar a emissão desta empresa: {certificadoOk ? "certificado digital válido ✔" : "cadastre o certificado digital A1 em Notas automáticas"}
              {"; "}
              {servicos ? `${servicos} serviço(s) cadastrado(s) ✔` : "cadastre os serviços com o código de tributação"}
              {"; registre a autorização do cliente e ligue a emissão em "}
              <Link href={`${base}/configuracao`} className="font-medium underline">
                Configurar emissão
              </Link>
              . Nenhuma nota é enviada enquanto a emissão estiver desligada.
            </>
          ) : (
            "O escritório ainda não ligou a emissão de notas para a sua empresa (é preciso o certificado digital e o cadastro dos serviços). Fale com o escritório."
          )}
        </Alerta>
      ) : cfg?.ambiente === "homologacao" ? (
        <Alerta tom="info" className="mb-4" titulo="Emissão em teste">
          As notas desta empresa saem no ambiente de testes do governo (produção restrita), sem validade jurídica. O escritório passa para produção depois de conferir.
        </Alerta>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Notas emitidas no mês" valor={emitidas.length} icone={FileText} detalhe={producao.length !== lista.length ? "Notas de teste não contam." : undefined} />
        <Indicador rotulo="Valor emitido" valor={formatarMoeda(total)} tom="sucesso" />
        <Indicador
          rotulo="Não emitidas ou canceladas"
          valor={lista.filter((n) => ["rejeitada", "falha", "cancelada"].includes(n.situacao)).length}
          tom={lista.some((n) => n.situacao === "rejeitada" || n.situacao === "falha") ? "alerta" : "neutro"}
        />
      </div>

      <Card>
        <CardContent className="p-0 sm:p-0">
          {lista.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th className="hidden sm:table-cell">Número</Th>
                  <Th>Tomador</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {lista.map((n) => {
                  const s = SITUACAO_NFSE[n.situacao as SituacaoNfse];
                  return (
                    <Tr key={n.id}>
                      <Td className="whitespace-nowrap">
                        <Link href={`${base}/${n.id}`} className="font-medium underline-offset-4 hover:underline">
                          {formatarData(n.competencia)}
                        </Link>
                      </Td>
                      <Td className="hidden sm:table-cell numero">{n.numero_nfse ?? <span className="text-muted-foreground">DPS {n.numero_dps}</span>}</Td>
                      <Td>
                        {n.tomador_tipo === "nao_identificado" ? (
                          <span className="text-muted-foreground">Não identificado</span>
                        ) : (
                          <>
                            {n.tomador_nome}
                            <span className="block text-xs text-muted-foreground">{formatarDocumento(n.tomador_documento)}</span>
                          </>
                        )}
                      </Td>
                      <Td className="text-right numero whitespace-nowrap">{formatarMoeda(n.valor)}</Td>
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
              titulo="Nenhuma nota neste mês"
              descricao={ativa ? "Use “Emitir nota” para emitir a primeira." : "Quando a emissão estiver ligada, as notas emitidas aparecem aqui."}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
