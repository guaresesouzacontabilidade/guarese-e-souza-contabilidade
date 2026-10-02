import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Undo2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AssistenteImportacao } from "@/components/financeiro/assistente-importacao";
import { DesfazerImportacao } from "@/components/financeiro/desfazer-importacao";
import { analisarArquivo, lerDocumentoParaImportacao, prepararExtrato, sugerirMapeamentoLancamentos, EXTENSOES_IMPORTAVEIS, type PreviaExtrato } from "@/lib/financeiro/importacao";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Importar extratos e planilhas" };
const UUID = /^[0-9a-f-]{36}$/i;

const TIPO_IMPORTACAO: Record<string, string> = {
  extrato_ofx: "Extrato OFX",
  extrato_planilha: "Extrato em planilha",
  lancamentos_planilha: "Contas a pagar/receber",
};

export default async function Importar({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/importar">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.importar")) return <Alerta tom="alerta">Seu acesso não permite importar extratos.</Alerta>;
  const base = `/e/${empresaId}/financeiro/importar`;
  const documentoId = UUID.test(parametro(sp, "documento")) ? parametro(sp, "documento") : null;
  const { data: contas } = await ctx.supabase.from("contas_financeiras").select("id, nome, tipo, numero").eq("empresa_id", empresaId).eq("ativa", true).order("nome");

  if (documentoId) {
    let conteudo: React.ReactNode;
    try {
      const arq = await lerDocumentoParaImportacao(ctx, empresaId, documentoId);
      const analise = await analisarArquivo(arq);
      let contaSugerida: string | null = null;
      let previa: PreviaExtrato | null = null;
      if (analise.tipo === "ofx") {
        const dig = (s: string | null) => (s ?? "").replace(/\D/g, "");
        const conta = (contas ?? []).find((c) => {
          const n = dig(c.numero);
          const o = dig(analise.conta);
          return n && o && (o.endsWith(n) || n.endsWith(o));
        });
        contaSugerida = conta?.id ?? null;
        previa = (await prepararExtrato(ctx, analise, null, contaSugerida)).previa;
      }
      conteudo = (
        <AssistenteImportacao
          empresaId={empresaId}
          documento={{ id: arq.id, nome: arq.nome }}
          tipoArquivo={analise.tipo}
          contas={(contas ?? []).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }))}
          contaSugerida={contaSugerida}
          ofx={analise.tipo === "ofx" ? { conta: analise.conta, banco: analise.banco, cartao: analise.cartao, inicio: analise.inicio, fim: analise.fim } : null}
          amostra={analise.tipo === "planilha" ? analise.linhas.slice(0, 30) : []}
          mapeamento={analise.tipo === "planilha" ? analise.mapeamento : null}
          mapeamentoLanc={analise.tipo === "planilha" ? sugerirMapeamentoLancamentos(analise.linhas) : null}
          previaInicial={previa}
        />
      );
    } catch (e) {
      conteudo = <Alerta tom="perigo">{e instanceof Error ? e.message : "Não foi possível ler o arquivo."}</Alerta>;
    }
    return (
      <>
        <CabecalhoPagina voltar={{ href: base, rotulo: "Importações" }} titulo="Importar arquivo" descricao="Confira as colunas e a prévia. Movimentações já importadas são reconhecidas e não se repetem." />
        {conteudo}
      </>
    );
  }

  const [{ data: docs }, { data: importacoes }] = await Promise.all([
    ctx.supabase
      .from("documentos")
      .select("id, nome_original, competencia, categoria_codigo, enviado_em, extensao")
      .eq("empresa_id", empresaId)
      .eq("upload_status", "concluido")
      .is("excluido_em", null)
      .in("extensao", EXTENSOES_IMPORTAVEIS)
      .neq("verificacao_status", "bloqueado")
      .order("enviado_em", { ascending: false })
      .limit(40),
    ctx.supabase
      .from("importacoes")
      .select("id, tipo, arquivo_nome, documento_id, status, total_linhas, total_novas, total_duplicadas, total_invalidas, total_periodo_fechado, periodo_inicio, periodo_fim, soma_creditos, soma_debitos, created_at, motivo_desfazer, conta:contas_financeiras(nome)")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const importados = new Set((importacoes ?? []).filter((i) => i.status === "concluida").map((i) => i.documento_id));

  return (
    <>
      <CabecalhoPagina
        titulo="Importar extratos e planilhas"
        descricao="OFX dos bancos, extratos em CSV/XLSX e planilhas de contas a pagar/receber. Importar não cria receitas nem despesas: as movimentações seguem para a conciliação."
        acoes={
          <Button asChild variante="contorno">
            <Link href={`/e/${empresaId}/enviar`}>
              <FileUp /> Enviar novo arquivo
            </Link>
          </Button>
        }
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>1. Escolha o arquivo</CardTitle>
          <CardDescription>Arquivos OFX, CSV ou XLSX já enviados ao portal. Para um arquivo novo, envie primeiro em “Enviar documentos”.</CardDescription>
        </CardHeader>
        <CardContent>
          {docs?.length ? (
            <ul className="divide-y divide-border text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.nome_original}</span>
                    <span className="text-xs text-muted-foreground">
                      competência {formatarCompetencia(d.competencia)} · enviado em {formatarDataHora(d.enviado_em)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {importados.has(d.id) ? <Badge variante="sucesso">Já importado</Badge> : null}
                    <Button asChild tamanho="sm" variante={importados.has(d.id) ? "contorno" : "primario"}>
                      <Link href={urlCom(base, {}, { documento: d.id })}>{importados.has(d.id) ? "Ver / importar em outra conta" : "Importar"}</Link>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EstadoVazio icone={FileUp} titulo="Nenhum arquivo para importar" descricao="Envie o extrato do banco (de preferência em OFX) em “Enviar documentos”." />
          )}
        </CardContent>
      </Card>

      <h2 className="mb-2 text-base font-semibold text-titulo">Histórico de importações</h2>
      {importacoes?.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Data</Th>
              <Th>Arquivo</Th>
              <Th>Período</Th>
              <Th className="text-right">Novas</Th>
              <Th className="text-right">Repetidas</Th>
              <Th className="text-right">Inválidas</Th>
              <Th>Situação</Th>
              <Th className="w-10">
                <span className="sr-only">Desfazer</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {importacoes.map((i) => (
              <Tr key={i.id}>
                <Td className="whitespace-nowrap text-sm">{formatarDataHora(i.created_at)}</Td>
                <Td className="max-w-[18rem]">
                  <span className="block truncate text-sm font-medium">{i.arquivo_nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {TIPO_IMPORTACAO[i.tipo] ?? i.tipo}
                    {(i.conta as { nome: string } | null)?.nome ? ` · ${(i.conta as { nome: string }).nome}` : ""}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-sm">
                  {i.periodo_inicio ? `${formatarData(i.periodo_inicio)} a ${formatarData(i.periodo_fim)}` : "—"}
                  {i.tipo !== "lancamentos_planilha" && (i.soma_creditos || i.soma_debitos) ? (
                    <span className="block text-xs text-muted-foreground">
                      {formatarMoeda(i.soma_creditos)} / {formatarMoeda(i.soma_debitos)}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-right numero">{i.total_novas}</Td>
                <Td className="text-right numero">{i.total_duplicadas}</Td>
                <Td className="text-right numero">{i.total_invalidas + i.total_periodo_fechado}</Td>
                <Td>
                  {i.status === "desfeita" ? (
                    <Badge variante="neutro" title={i.motivo_desfazer ?? undefined}>
                      <Undo2 /> Desfeita
                    </Badge>
                  ) : (
                    <Badge variante="sucesso">Concluída</Badge>
                  )}
                </Td>
                <Td>{i.status === "concluida" ? <DesfazerImportacao empresaId={empresaId} importacaoId={i.id} /> : null}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma importação realizada.</p>
      )}
    </>
  );
}
