import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { ConferirColunas } from "@/components/maquininhas/colunas";
import { AcoesRelatorio } from "@/components/maquininhas/relatorio";
import type { Adquirente } from "@/components/maquininhas/contratos";
import { sugerirAdquirente, sugerirMapeamento, type MapeamentoMaquininha } from "@/lib/maquininhas/leitura";
import { SITUACAO_IMPORTACAO } from "@/lib/maquininhas/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Relatório da maquininha" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RelatorioMaquininha({ params }: PageProps<"/e/[empresaId]/maquininhas/importacoes/[importacaoId]">) {
  const { empresaId, importacaoId } = await params;
  if (!UUID.test(importacaoId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("maquininhas.ver")) return <Alerta tom="alerta">Seu acesso não inclui a conferência das maquininhas desta empresa.</Alerta>;
  const gerenciar = ctx.pode("maquininhas.gerenciar");
  const base = `/e/${empresaId}`;
  const [{ data: imp }, { data: catalogo }] = await Promise.all([
    ctx.supabase
      .from("maquininha_importacoes")
      .select(
        "id, documento_id, nome_arquivo, situacao, adquirente_codigo, adquirente_nome, cabecalho, amostra, mapeamento, linhas, periodo_inicio, periodo_fim, vendas, duplicadas, canceladas, invalidas, total_bruto, total_taxas, total_acima, erros, erro, created_at, concluida_em",
      )
      .eq("id", importacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("maquininha_adquirentes").select("codigo, nome, tipo").eq("ativo", true).order("ordem").order("nome"),
  ]);
  if (!imp) notFound();
  const lista = (catalogo ?? []) as Adquirente[];
  const cabecalho = (Array.isArray(imp.cabecalho) ? imp.cabecalho : []) as string[];
  const amostra = (Array.isArray(imp.amostra) ? imp.amostra : []) as string[][];
  const situacao = SITUACAO_IMPORTACAO[imp.situacao] ?? { rotulo: imp.situacao, variante: "neutro" as const };
  const mapeamento = (imp.mapeamento as MapeamentoMaquininha | null) ?? sugerirMapeamento(cabecalho, 0);
  const sugerida = imp.adquirente_codigo ?? sugerirAdquirente([imp.nome_arquivo ?? "", ...cabecalho], lista)?.codigo ?? "";
  const adquirenteInicial = imp.adquirente_nome && !imp.adquirente_codigo ? "outra" : sugerida;
  const conferir = gerenciar && ["aguardando_mapeamento", "erro", "importada"].includes(imp.situacao) && cabecalho.length > 0;
  const andamento = imp.situacao === "na_fila" || imp.situacao === "importando";
  const erros = (Array.isArray(imp.erros) ? imp.erros : []) as { linha: number; motivo: string; conteudo?: string }[];

  return (
    <>
      <CabecalhoPagina
        titulo={imp.nome_arquivo ?? "Relatório da maquininha"}
        descricao={`${imp.adquirente_nome ?? "Adquirente a definir"} · recebido em ${formatarDataHora(imp.created_at)}`}
        voltar={{ href: `${base}/maquininhas`, rotulo: "Voltar às maquininhas" }}
        acoes={
          <>
            <Badge variante={situacao.variante}>{situacao.rotulo}</Badge>
            {imp.documento_id && ctx.pode("documentos.ver") ? (
              <Button asChild variante="contorno" tamanho="sm">
                <Link href={`${base}/documentos/${imp.documento_id}`}>
                  <FileText /> Ver documento
                </Link>
              </Button>
            ) : null}
            {gerenciar ? (
              <AcoesRelatorio
                empresaId={empresaId}
                importacaoId={imp.id}
                reimportar={Boolean(imp.mapeamento) && ["importada", "erro"].includes(imp.situacao)}
                excluir
              />
            ) : null}
          </>
        }
      />
      <AtualizarEnquanto ativo={andamento} />

      {andamento ? (
        <Alerta tom="info" className="mb-4">
          Importando as vendas e conferindo com o contrato. Esta página se atualiza sozinha.
        </Alerta>
      ) : null}
      {imp.situacao === "erro" && imp.erro ? (
        <Alerta tom="perigo" className="mb-4" titulo="Não foi possível importar">
          {imp.erro}
        </Alerta>
      ) : null}

      {imp.situacao === "importada" ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>
              Vendas de {formatarData(imp.periodo_inicio)} a {formatarData(imp.periodo_fim)}, importadas em {formatarDataHora(imp.concluida_em)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Vendas aprovadas</dt>
                <dd className="numero text-lg font-semibold">{(imp.vendas ?? 0).toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor das vendas</dt>
                <dd className="numero text-lg font-semibold">{formatarMoeda(imp.total_bruto)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Taxas cobradas</dt>
                <dd className="numero text-lg font-semibold">{formatarMoeda(imp.total_taxas)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Acima do contrato</dt>
                <dd className={Number(imp.total_acima ?? 0) > 0 ? "numero text-lg font-semibold text-perigo" : "numero text-lg font-semibold"}>
                  {formatarMoeda(imp.total_acima ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {imp.duplicadas ? `${imp.duplicadas} vendas já tinham vindo em outro relatório (contadas uma vez só). ` : ""}
              {imp.canceladas ? `${imp.canceladas} canceladas ou não aprovadas ficaram fora da conta. ` : ""}
              {imp.invalidas ? `${imp.invalidas} linhas não puderam ser lidas.` : ""}
            </p>
            <Button asChild variante="contorno" tamanho="sm" className="mt-3">
              <Link href={`${base}/maquininhas?competencia=${String(imp.periodo_fim ?? "").slice(0, 7)}`}>Ver a conferência do mês</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {erros.length ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Linhas não lidas</CardTitle>
            <CardDescription>Confira se as colunas estão certas. Linhas de total e de título são ignoradas sozinhas.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th className="w-20">Linha</Th>
                  <Th>Motivo</Th>
                  <Th className="hidden md:table-cell">Conteúdo</Th>
                </Tr>
              </THead>
              <TBody>
                {erros.slice(0, 20).map((e) => (
                  <Tr key={e.linha}>
                    <Td className="numero">{e.linha}</Td>
                    <Td>{e.motivo}</Td>
                    <Td className="hidden max-w-md truncate text-xs text-muted-foreground md:table-cell">{e.conteudo}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {conferir ? (
        <Card>
          <CardHeader>
            <CardTitle>{imp.situacao === "aguardando_mapeamento" ? "Confira as colunas deste relatório" : "Corrigir as colunas"}</CardTitle>
            <CardDescription>
              {imp.situacao === "aguardando_mapeamento"
                ? "É a primeira vez que este formato chega. Diga uma vez qual coluna é cada informação e o portal aprende."
                : "Se alguma coluna foi entendida errado, ajuste e importe de novo."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConferirColunas
              empresaId={empresaId}
              importacaoId={imp.id}
              cabecalho={cabecalho}
              amostra={amostra}
              inicial={mapeamento}
              catalogo={lista}
              adquirenteInicial={adquirenteInicial}
              nomeOutraInicial={imp.adquirente_codigo ? "" : (imp.adquirente_nome ?? "")}
              equipe={ctx.equipe}
            />
          </CardContent>
        </Card>
      ) : imp.situacao === "aguardando_mapeamento" ? (
        <Alerta tom="info">O escritório vai conferir as colunas deste relatório e importar as vendas.</Alerta>
      ) : null}
    </>
  );
}
