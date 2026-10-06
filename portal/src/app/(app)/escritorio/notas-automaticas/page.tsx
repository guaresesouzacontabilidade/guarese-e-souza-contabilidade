import type { Metadata } from "next";
import Link from "next/link";
import { CloudDownload, FileArchive, FileSpreadsheet } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormLoteXml } from "@/components/lotes-xml/form-lote";
import { BotaoPedirXmlCarteira } from "@/components/notas-automaticas/notas-automaticas";
import { FormPlanilhaEntradas } from "@/components/notas-automaticas/planilha-entradas";
import { TabelaLotes, emPreparo, tiposTexto, type LoteXml } from "@/components/lotes-xml/tabela-lotes";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { pedirLotesXmlCarteira } from "@/lib/lotes-xml/acoes";
import { mesesDoLote } from "@/lib/lotes-xml/rotulos";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { SITUACAO_NOTAS, situacaoNotas } from "@/lib/notas-automaticas/rotulos";
import { estadoSemXml } from "@/lib/notas-automaticas/situacao-xml";
import { envServidor } from "@/lib/env-servidor";
import { competenciaAtual, diasEntre, hojeISO, somarDias } from "@/lib/competencia";
import { formatarCnpj, formatarCompetencia, formatarData, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Notas automáticas" };

export default async function NotasAutomaticasCarteira() {
  const s = await exigirEquipe();
  const hoje = hojeISO();
  const desde = `${somarDias(hoje, -30)}T00:00:00Z`;
  const resultado = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento").order("razao_social").range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase
        .from("notas_automaticas")
        .select("empresa_id, pausada, nfe_ativa, nfse_ativa, ciencia_automatica, erros_seguidos, certificado_valido_ate, ultima_execucao, ultimo_erro, buscar_desde")
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("documentos").select("empresa_id").eq("origem", "automatica").gte("enviado_em", desde).range(de, ate)),
    // NF-e recebidas só em resumo (sem o XML completo no portal)
    buscarTudo((de, ate) =>
      s.supabase
        .from("nfe_resumos")
        .select("empresa_id, data_emissao, ciencia_em, ciencia_retorno, confirmacao_pedida_em, confirmacao_em, confirmacao_retorno")
        .eq("situacao", "autorizada")
        .is("documento_id", null)
        .order("id")
        .range(de, ate),
    ),
  ])
    .then(([empresas, configs, docs, resumos]) => ({ empresas, configs, docs, resumos, erro: null as string | null }))
    .catch((e: unknown) => ({ empresas: [], configs: [], docs: [], resumos: [], erro: mensagemErro(e) }));
  const porEmpresa = new Map(resultado.configs.map((c) => [c.empresa_id, c]));
  const trazidas = new Map<string, number>();
  for (const d of resultado.docs) trazidas.set(d.empresa_id, (trazidas.get(d.empresa_id) ?? 0) + 1);
  // Por empresa: sem a ciência ainda, a caminho (ciência ou confirmação registrada ou pedida) e recusadas pela SEFAZ
  const semXmlPorEmpresa = new Map<string, { pendentes: number; aCaminho: number; recusadas: number }>();
  for (const r of resultado.resumos) {
    const t = semXmlPorEmpresa.get(r.empresa_id) ?? { pendentes: 0, aCaminho: 0, recusadas: 0 };
    const e = estadoSemXml(r);
    if (e === "aguardando_ciencia") t.pendentes++;
    else if (e === "ciencia_recusada" || e === "confirmacao_recusada") t.recusadas++;
    else t.aCaminho++;
    semXmlPorEmpresa.set(r.empresa_id, t);
  }

  const linhas = resultado.empresas
    .map((e) => {
      const cfg = porEmpresa.get(e.id) ?? null;
      const situacao = situacaoNotas(cfg?.certificado_valido_ate ? { valido_ate: cfg.certificado_valido_ate } : null, cfg);
      const dias = cfg?.certificado_valido_ate ? diasEntre(hoje, cfg.certificado_valido_ate.slice(0, 10)) : null;
      return { ...e, cfg, situacao, dias, notas: trazidas.get(e.id) ?? 0, semXml: semXmlPorEmpresa.get(e.id) ?? { pendentes: 0, aCaminho: 0, recusadas: 0 } };
    })
    .sort((a, b) => {
      const ordem = { erro: 0, vencido: 1, pausada: 2, ativa: 3, desconectada: 4 } as const;
      return ordem[a.situacao] - ordem[b.situacao] || (a.nome_fantasia ?? a.razao_social).localeCompare(b.nome_fantasia ?? b.razao_social, "pt-BR");
    });
  const ativas = linhas.filter((l) => l.situacao === "ativa").length;
  const comErro = linhas.filter((l) => l.situacao === "erro" || l.situacao === "vencido").length;
  const vencendo = linhas.filter((l) => l.dias !== null && l.dias >= 0 && l.dias <= 30).length;
  const chaveServidor = Boolean(envServidor.certificadosChave());
  const totalSemXml = resultado.resumos.length;
  const buscando = (l: (typeof linhas)[number]) => l.situacao === "ativa" || l.situacao === "erro";
  const cienciaLigada = (l: (typeof linhas)[number]) => Boolean(l.cfg?.ciencia_automatica && l.cfg.nfe_ativa);
  const somar = (lista: typeof linhas, campo: "pendentes" | "aCaminho" | "recusadas") => lista.reduce((t, l) => t + l.semXml[campo], 0);
  // Empresas com certificado válido em que as NF-e chegam só em resumo (ciência desligada)
  const semCiencia = linhas.filter((l) => buscando(l) && !cienciaLigada(l)).length;
  const aguardandoCiencia = somar(linhas.filter((l) => buscando(l) && cienciaLigada(l)), "pendentes");
  const aCaminho = somar(linhas, "aCaminho");
  const recusadas = somar(linhas, "recusadas");
  // Sem a ciência em empresas pausadas ou sem certificado válido: nada sai até resolver na empresa
  const paradas = somar(linhas.filter((l) => !buscando(l)), "pendentes");

  // Lotes de XML pedidos para a carteira nos últimos 8 dias, agrupados por pedido
  const { data: lotesCarteira } = await s.supabase
    .from("xml_lotes")
    .select("id, empresa_id, competencia, tipos, situacao, partes, total_arquivos, resumo, erro, criado_em, expira_em, pedido_id, empresa:empresas(razao_social, nome_fantasia)")
    .not("pedido_id", "is", null)
    .gte("criado_em", `${somarDias(hoje, -8)}T00:00:00Z`)
    .order("criado_em", { ascending: false })
    .limit(500);
  const pedidos = new Map<string, LoteXml[]>();
  for (const l of (lotesCarteira ?? []) as unknown as (LoteXml & { pedido_id: string })[]) {
    pedidos.set(l.pedido_id, [...(pedidos.get(l.pedido_id) ?? []), l]);
  }
  const { meses, padrao } = mesesDoLote(competenciaAtual());

  return (
    <>
      <CabecalhoPagina
        titulo="Notas automáticas"
        descricao="Busca das notas fiscais de cada empresa na SEFAZ e no Ambiente Nacional da NFS-e com o certificado A1. Desligada em cada empresa até o certificado ser cadastrado."
      />
      {resultado.erro ? <Alerta tom="perigo" className="mb-4">{resultado.erro}</Alerta> : null}
      {!chaveServidor ? (
        <Alerta tom="alerta" className="mb-4" titulo="Cadastro de certificados indisponível">
          Falta configurar no servidor a chave de criptografia dos certificados (CERTIFICADOS_CHAVE). Veja o guia de configuração.
        </Alerta>
      ) : null}
      {envServidor.notasSemRede() ? (
        <Alerta tom="info" className="mb-4" titulo="Consultas desligadas neste ambiente">
          Este é um ambiente de demonstração ou de teste: o portal não consulta a SEFAZ nem o Ambiente Nacional daqui. No portal oficial, a busca funciona
          com o certificado da empresa.
        </Alerta>
      ) : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Busca ativa" valor={ativas} tom={ativas ? "sucesso" : "neutro"} />
        <Indicador rotulo="Com erro ou vencido" valor={comErro} tom={comErro ? "perigo" : "neutro"} />
        <Indicador rotulo="Certificado vence em 30 dias" valor={vencendo} tom={vencendo ? "alerta" : "neutro"} />
        <Indicador rotulo="NF-e sem o XML completo" valor={totalSemXml} tom={totalSemXml ? "alerta" : "neutro"} detalhe="recebidas só em resumo" href="#nfe-entrada" />
      </div>
      <Card className="mb-4 scroll-mt-20" id="nfe-entrada">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" /> NF-e de entrada da carteira
          </CardTitle>
          <CardDescription>
            Planilha com as NF-e de entrada emitidas no mês para todas as empresas (as recebidas só em resumo e as que já têm o XML no portal), com
            fornecedor, valor, situação, chave de acesso, a coluna “XML completo no portal” e uma aba com os totais por empresa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormPlanilhaEntradas meses={meses} padrao={padrao} />
          {totalSemXml || semCiencia ? (
            <Alerta
              tom="alerta"
              titulo={
                totalSemXml
                  ? `${totalSemXml === 1 ? "1 NF-e" : `${totalSemXml} NF-e`} sem o XML completo`
                  : `Ciência automática desligada em ${semCiencia === 1 ? "1 empresa" : `${semCiencia} empresas`}`
              }
            >
              <p>
                A SEFAZ só libera o XML completo da NF-e recebida depois da ciência da emissão, aceita até 10 dias depois da emissão da nota. Com o
                XML no portal, as notas entram no XML da carteira em lote.
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {semCiencia ? (
                  <li>
                    Ciência automática desligada em {semCiencia === 1 ? "1 empresa com certificado válido" : `${semCiencia} empresas com certificado válido`}:
                    as notas delas chegam só em resumo.
                  </li>
                ) : null}
                {aguardandoCiencia ? (
                  <li>
                    {aguardandoCiencia === 1 ? "1 NF-e aguardando" : `${aguardandoCiencia} NF-e aguardando`} a ciência, que o portal registra na próxima
                    busca.
                  </li>
                ) : null}
                {aCaminho ? (
                  <li>
                    {aCaminho === 1 ? "1 NF-e com a ciência ou a confirmação da operação registrada ou pedida" : `${aCaminho} NF-e com a ciência ou a confirmação da operação registrada ou pedida`}:
                    o XML chega nas próximas buscas.
                  </li>
                ) : null}
                {recusadas ? (
                  <li>
                    {recusadas === 1 ? "1 NF-e teve" : `${recusadas} NF-e tiveram`} a ciência recusada pela SEFAZ (em geral, por passar do prazo de 10
                    dias): na página da empresa, confirme a operação (até 180 dias depois da emissão) ou envie em Documentos o XML pedido ao fornecedor.
                  </li>
                ) : null}
                {paradas ? (
                  <li>
                    {paradas === 1 ? "1 NF-e é de empresa" : `${paradas} NF-e são de empresas`} com a busca pausada ou sem certificado válido: resolva
                    na página da empresa (lista abaixo).
                  </li>
                ) : null}
              </ul>
              {semCiencia ? (
                <div className="pt-2">
                  <BotaoPedirXmlCarteira />
                </div>
              ) : null}
            </Alerta>
          ) : null}
        </CardContent>
      </Card>
      <Card className="mb-4 scroll-mt-20" id="lotes-xml">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="size-4" /> XML da carteira em lote
          </CardTitle>
          <CardDescription>
            Gera, de uma vez, o ZIP com os XML do mês de cada empresa que tem notas dos tipos escolhidos (um arquivo por empresa, com pastas por tipo
            e a planilha da relação das notas). Você recebe um aviso quando todos ficarem prontos; os arquivos ficam disponíveis por 7 dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormLoteXml acao={pedirLotesXmlCarteira} meses={meses} padrao={padrao} textoBotao="Gerar para a carteira" />
          {[...pedidos.values()].map((lotes) => {
            const prontos = lotes.filter((l) => l.situacao === "pronto").length;
            const preparo = lotes.filter(emPreparo).length;
            const ordenados = [...lotes].sort((a, b) =>
              (a.empresa?.nome_fantasia ?? a.empresa?.razao_social ?? "").localeCompare(b.empresa?.nome_fantasia ?? b.empresa?.razao_social ?? "", "pt-BR"),
            );
            return (
              <div key={lotes[0].id} className="rounded-md border border-border">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2">
                  <p className="text-sm font-medium">
                    {formatarCompetencia(lotes[0].competencia)} · {tiposTexto(lotes[0].tipos)}
                    <span className="block text-xs font-normal text-muted-foreground">pedido em {formatarDataHora(lotes[0].criado_em)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {prontos} de {lotes.length} {lotes.length === 1 ? "empresa pronta" : "empresas prontas"}
                    {preparo ? ` · ${preparo} em preparo` : ""}
                  </p>
                </div>
                <TabelaLotes lotes={ordenados} mostrarEmpresa />
              </div>
            );
          })}
          <AtualizarEnquanto ativo={(lotesCarteira ?? []).some(emPreparo)} limiteMs={900_000} intervaloMs={8000} />
        </CardContent>
      </Card>

      {linhas.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Situação</Th>
                  <Th className="hidden md:table-cell">Certificado</Th>
                  <Th className="hidden md:table-cell">Última busca</Th>
                  <Th className="hidden lg:table-cell">Notas desde</Th>
                  <Th className="hidden sm:table-cell text-right">XML em 30 dias</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => {
                  const st = SITUACAO_NOTAS[l.situacao];
                  return (
                    <Tr key={l.id}>
                      <Td>
                        <Link href={`/e/${l.id}/notas-automaticas`} className="font-medium text-primary hover:underline">
                          {l.nome_fantasia ?? l.razao_social}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{l.documento ? formatarCnpj(l.documento) : ""}</span>
                        {l.semXml.pendentes + l.semXml.aCaminho + l.semXml.recusadas ? (
                          <span className="block text-xs text-alerta-fg">
                            {l.semXml.pendentes + l.semXml.aCaminho + l.semXml.recusadas} NF-e sem o XML completo
                            {l.semXml.recusadas ? ` (${l.semXml.recusadas} com a ciência recusada)` : ""}
                          </span>
                        ) : null}
                        {l.cfg?.ultimo_erro && (l.situacao === "erro" || l.situacao === "vencido") ? (
                          <span className="block max-w-md truncate text-xs text-perigo" title={l.cfg.ultimo_erro}>
                            {l.cfg.ultimo_erro}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge variante={st.tom}>{st.rotulo}</Badge>
                      </Td>
                      <Td className={`hidden text-sm md:table-cell ${l.dias !== null && l.dias <= 30 ? "text-perigo" : ""}`}>
                        {l.cfg?.certificado_valido_ate ? `até ${formatarData(l.cfg.certificado_valido_ate.slice(0, 10))}` : "—"}
                      </Td>
                      <Td className="hidden text-sm md:table-cell">{l.cfg?.ultima_execucao ? formatarRelativo(l.cfg.ultima_execucao) : "—"}</Td>
                      <Td className="hidden text-sm lg:table-cell">{!l.cfg ? "—" : l.cfg.buscar_desde ? formatarCompetencia(l.cfg.buscar_desde) : "Tudo disponível"}</Td>
                      <Td className="hidden text-right sm:table-cell">{l.notas || "—"}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={CloudDownload} titulo="Nenhuma empresa na carteira" />
      )}
    </>
  );
}
