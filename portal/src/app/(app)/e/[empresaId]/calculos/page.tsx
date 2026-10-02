import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, ExternalLink, FileCheck2, ListChecks, Settings, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { calcularPrevisao, type DadosPrevisao, type LinhaPrevisao } from "@/lib/calculos/previsao";
import { competenciaDosCalculos, opcoesCompetencia } from "@/lib/calculos/competencias";
import { PRIMEIRA_COMPETENCIA } from "@/lib/calculos/tabelas";
import { somarMeses } from "@/lib/competencia";
import { mensagemErro } from "@/lib/acoes";
import { parametro } from "@/lib/busca";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Previsão de impostos" };

function TabelaLinhas({ linhas, titulo, total, rotuloTotal }: { linhas: LinhaPrevisao[]; titulo: string; total: string; rotuloTotal: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <Table>
          <THead>
            <Tr>
              <Th>Imposto</Th>
              <Th className="hidden sm:table-cell">Vencimento</Th>
              <Th className="text-right">Valor estimado</Th>
            </Tr>
          </THead>
          <TBody>
            {linhas.map((l) => (
              <Tr key={l.chave}>
                <Td className="align-top">
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      <span className="font-medium text-titulo">{l.tributo}</span>{" "}
                      <span className="text-xs text-muted-foreground">· {l.guia}</span>
                      <span className="ml-1 text-xs text-primary group-open:hidden">ver cálculo</span>
                      <span className="block text-xs text-muted-foreground sm:hidden">{l.vencimento ? `Vence em ${formatarData(l.vencimento)}` : "Vencimento conforme a guia"}</span>
                    </summary>
                    {l.detalhes.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {l.detalhes.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                </Td>
                <Td className="hidden align-top text-sm sm:table-cell">{l.vencimento ? formatarData(l.vencimento) : <span className="text-muted-foreground">conforme a guia</span>}</Td>
                <Td className="text-right align-top">
                  <span className="numero font-semibold">{formatarMoeda(l.valor)}</span>
                  {l.valorGuia ? (
                    <span className="block text-xs text-sucesso">
                      <FileCheck2 className="inline size-3" aria-hidden /> guia: {formatarMoeda(l.valorGuia)}
                    </span>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
          <TFoot>
            <Tr>
              <Td className="font-semibold">{rotuloTotal}</Td>
              <Td className="hidden sm:table-cell" />
              <Td className="text-right numero font-bold text-titulo">{total}</Td>
            </Tr>
          </TFoot>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function PrevisaoImpostos({ params, searchParams }: PageProps<"/e/[empresaId]/calculos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.ver")) return null;
  const comp = competenciaDosCalculos(parametro(sp, "competencia"));
  const gerenciar = ctx.pode("calculos.gerenciar");
  const base = `/e/${empresaId}`;

  const { data, error } = await ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: comp });
  const cabecalho = (
    <CabecalhoPagina
      titulo="Previsão de impostos"
      descricao="Estimativa dos impostos do mês pelo regime da empresa, com base nos documentos enviados e nas tabelas oficiais. Os valores oficiais são os das guias emitidas pelo escritório."
      acoes={
        <>
          <SeletorCompetencia valor={comp.slice(0, 7)} opcoes={opcoesCompetencia()} />
          {gerenciar ? (
            <Button asChild variante="contorno">
              <Link href={`${base}/calculos/configuracao?competencia=${comp.slice(0, 7)}`}>
                <Settings /> Configurar
              </Link>
            </Button>
          ) : null}
        </>
      }
    />
  );
  if (error || !data) {
    return (
      <>
        {cabecalho}
        <Alerta tom="perigo">{mensagemErro(error)}</Alerta>
      </>
    );
  }

  const p = calcularPrevisao(data as unknown as DadosPrevisao);
  const mesComp = formatarCompetencia(p.competencia, true);
  const mesPag = formatarCompetencia(p.mesPagamento, true);
  const aPagar = p.linhas.filter((l) => l.grupo === "pagar");
  const reservas = p.linhas.filter((l) => l.grupo === "provisao");
  const faltam = p.checklist.faltantes.length;
  const liberadoCliente = p.situacao !== "sem_parametros" && p.situacao !== "competencia_nao_suportada" && faltam === 0;
  const anterior = somarMeses(p.competencia, -1);
  const mostrarValores = ctx.equipe ? p.situacao !== "sem_parametros" && p.situacao !== "competencia_nao_suportada" : liberadoCliente;

  return (
    <>
      {cabecalho}

      {p.situacao === "competencia_nao_suportada" ? <Alerta tom="info">{p.mensagem}</Alerta> : null}

      {p.situacao === "sem_parametros" ? (
        <EstadoVazio
          icone={Calculator}
          titulo={ctx.equipe ? "Configure os cálculos desta empresa" : "O escritório está preparando a sua previsão"}
          descricao={
            ctx.equipe
              ? "Defina o anexo do Simples, a atividade do MEI ou os percentuais do Lucro Presumido, a alíquota do ISS e o pró-labore. A previsão passa a aparecer para o cliente quando os documentos do mês forem enviados."
              : "Assim que o escritório concluir a configuração, a previsão dos impostos de cada mês aparece aqui."
          }
          acao={
            gerenciar ? (
              <Button asChild>
                <Link href={`${base}/calculos/configuracao`}>
                  <Settings /> Configurar agora
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {p.situacao !== "sem_parametros" && p.situacao !== "competencia_nao_suportada" && faltam > 0 ? (
        ctx.equipe ? (
          <Alerta tom="alerta" className="mb-4" titulo={`O cliente ainda não vê esta previsão: ${faltam === 1 ? "falta 1 documento" : `faltam ${faltam} documentos`} de ${mesComp}`}>
            A previsão é liberada ao cliente quando todos os documentos obrigatórios do mês forem enviados.
          </Alerta>
        ) : (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Sua previsão de {mesComp} aparece assim que os documentos do mês forem enviados</CardTitle>
              <CardDescription>
                {faltam === 1 ? "Falta 1 documento obrigatório:" : `Faltam ${faltam} documentos obrigatórios:`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {p.checklist.faltantes.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <ListChecks className="size-4 text-muted-foreground" aria-hidden />
                    <span>{f.titulo}</span>
                    {f.status === "correcao" ? <Badge variante="alerta">precisa de correção</Badge> : null}
                    <span className="text-xs text-muted-foreground">prazo {formatarData(f.prazo)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {ctx.pode("documentos.enviar") ? (
                  <Button asChild>
                    <Link href={`${base}/enviar?competencia=${comp.slice(0, 7)}`}>
                      <Upload /> Enviar documentos
                    </Link>
                  </Button>
                ) : null}
                {ctx.pode("documentos.ver") ? (
                  <Button asChild variante="contorno">
                    <Link href={`${base}/pendencias?competencia=${comp.slice(0, 7)}`}>Ver pendências</Link>
                  </Button>
                ) : null}
                {anterior.slice(0, 7) >= PRIMEIRA_COMPETENCIA ? (
                  <Button asChild variante="fantasma">
                    <Link href={`${base}/calculos?competencia=${anterior.slice(0, 7)}`}>Ver a previsão de {formatarCompetencia(anterior, true)}</Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )
      ) : null}

      {mostrarValores ? (
        <div className="space-y-4">
          {p.situacao === "regime_nao_suportado" ? <Alerta tom="info">{p.mensagem}</Alerta> : null}

          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Indicador rotulo={`A pagar em ${mesPag}`} valor={formatarMoeda(p.totalPagar)} detalhe={`Impostos de ${mesComp} · ${p.regimeRotulo}`} tom="info" />
            <Indicador
              rotulo={`Faturamento de ${mesComp}`}
              valor={formatarMoeda(p.receita.total)}
              detalhe={
                p.receita.fonte === "notas"
                  ? `${p.receita.notas} ${p.receita.notas === 1 ? "nota fiscal de saída" : "notas fiscais de saída"}`
                  : p.receita.fonte === "informada"
                    ? "Informado pelo escritório"
                    : "Nenhuma nota de saída enviada"
              }
            />
            {p.totalProvisao.gt(0) ? (
              <Indicador rotulo="Reserva para o fim do trimestre" valor={formatarMoeda(p.totalProvisao)} detalhe="IRPJ e CSLL deste mês (pagos depois)" tom="alerta" />
            ) : (
              <Indicador
                rotulo="Guias oficiais"
                valor={p.guiasPublicadas > 0 ? `${p.guiasPublicadas} publicada${p.guiasPublicadas === 1 ? "" : "s"}` : "Ainda não publicadas"}
                detalhe={p.guiasPublicadas > 0 ? "Valores oficiais em Meus documentos" : "O escritório publica as guias em Documentos"}
                tom={p.guiasPublicadas > 0 ? "sucesso" : "neutro"}
                href={p.guiasPublicadas > 0 && ctx.pode("documentos.ver") ? `${base}/documentos?origem=escritorio&categoria=esc_guia&competencia=${comp.slice(0, 7)}` : undefined}
              />
            )}
          </div>

          {aPagar.length ? (
            <TabelaLinhas linhas={aPagar} titulo={`Impostos de ${mesComp} a pagar em ${mesPag}`} total={formatarMoeda(p.totalPagar)} rotuloTotal="Total estimado" />
          ) : p.situacao === "ok" ? (
            <Alerta tom="info">Nenhum imposto previsto para {mesComp} com os dados disponíveis.</Alerta>
          ) : null}

          {reservas.length ? (
            <TabelaLinhas linhas={reservas} titulo="Reserva para o fim do trimestre" total={formatarMoeda(p.totalProvisao)} rotuloTotal="Total a reservar" />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {p.memoria.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Como chegamos a esses valores</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm">
                    {p.memoria.map((m, i) => (
                      <div key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                        <dt className="text-muted-foreground">{m.rotulo}</dt>
                        <dd className="numero font-medium">{m.valor}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}
            {p.avisos.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Pontos de atenção</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                    {p.avisos.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {p.fontes.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Base legal e tabelas usadas</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {p.fontes.map((f) => (
                    <li key={f.titulo}>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {f.titulo} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        f.titulo
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Estimativa calculada pelo portal com as notas fiscais e os dados disponíveis em {formatarData(new Date().toISOString())}. Não substitui a apuração do
            escritório: os valores oficiais são os das guias publicadas. Nenhuma informação é enviada à Receita, à SEFAZ ou à prefeitura.
          </p>
        </div>
      ) : null}
    </>
  );
}
