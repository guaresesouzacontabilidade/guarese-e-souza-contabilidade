import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, Download, FileInput, FileText, ListChecks } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { GraficoBarras, GraficoLinhas } from "@/components/relatorios/graficos";
import { competenciaAtual, hojeISO } from "@/lib/competencia";
import { formatarCompetencia, formatarDocumento } from "@/lib/formatos";
import { parametro } from "@/lib/busca";
import { STATUS_COMPETENCIA, STATUS_DOCUMENTO } from "@/lib/rotulos";
import { periodoMensal } from "@/lib/relatorios/calculos";
import { percentualInteiro } from "@/lib/relatorios/carteira";
import { ABAS_ESCRITORIO, carregarRelatorioEscritorio, lerAbaEscritorio } from "@/lib/relatorios/escritorio-dados";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios do escritório" };

const UUID = /^[0-9a-f-]{36}$/i;

function tomPercentual(p: number | null) {
  if (p == null) return "text-muted-foreground";
  if (p >= 100) return "text-sucesso";
  if (p >= 60) return "text-foreground";
  if (p >= 30) return "text-alerta";
  return "text-perigo";
}

export default async function RelatoriosEscritorio({ searchParams }: PageProps<"/escritorio/relatorios">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const aba = lerAbaEscritorio(sp.aba);
  const { inicio, fim } = periodoMensal(parametro(sp, "de"), parametro(sp, "ate"), competenciaAtual());
  const responsavel = UUID.test(parametro(sp, "responsavel")) ? parametro(sp, "responsavel") : "";
  const situacao = parametro(sp, "situacao", ["ativas", "todas"]) === "todas" ? "todas" : "ativas";
  const filtros = { de: inicio.slice(0, 7), ate: fim.slice(0, 7), responsavel, situacao };

  const [r, { data: equipe }] = await Promise.all([
    carregarRelatorioEscritorio(s.supabase, { inicio, fim, responsavel, situacao }, hoje),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);

  const rotulosMes = r.meses.map((m) => formatarCompetencia(m));
  const totalItens = r.entrega.porMes.reduce((t, m) => t + m.total, 0);
  const itensOk = r.entrega.porMes.reduce((t, m) => t + m.ok, 0);
  const pctEntrega = percentualInteiro(itensOk, totalItens);
  const atrasados = r.pendencias.reduce((t, p) => t + p.atrasados, 0);
  const comAtraso = r.pendencias.filter((p) => p.atrasados > 0).length;
  const exportar = (formato: string) => urlCom("/api/relatorios/escritorio", {}, { ...filtros, aba, formato });
  const aqui = "/escritorio/relatorios";

  return (
    <>
      <CabecalhoPagina
        titulo="Relatórios do escritório"
        descricao={`Documentos, checklist, fechamento e pendências da carteira · ${
          inicio === fim ? formatarCompetencia(inicio, true) : `${formatarCompetencia(inicio, true)} a ${formatarCompetencia(fim, true)}`
        }`}
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <Download /> Excel
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("pdf")}>
                <FileText /> PDF
              </a>
            </Button>
          </>
        }
      />

      <form className="mb-5 flex flex-wrap items-end gap-2" aria-label="Filtros do relatório">
        <input type="hidden" name="aba" value={aba} />
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">De</span>
          <Input type="month" name="de" defaultValue={filtros.de} className="w-40" aria-label="Mês inicial" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">Até</span>
          <Input type="month" name="ate" defaultValue={filtros.ate} className="w-40" aria-label="Mês final" />
        </label>
        <Select name="responsavel" defaultValue={responsavel} aria-label="Contador responsável" className="w-56">
          <option value="">Todos os responsáveis</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <Select name="situacao" defaultValue={situacao} aria-label="Empresas" className="w-44">
          <option value="ativas">Empresas ativas</option>
          <option value="todas">Todas as empresas</option>
        </Select>
        <Button type="submit" variante="secundario">
          Atualizar
        </Button>
        <span className="text-xs text-muted-foreground">Até 24 meses por consulta.</span>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Documentos recebidos"
          valor={r.totalDocs.toLocaleString("pt-BR")}
          detalhe={`${r.docsPorStatus.aprovado ?? 0} aprovado(s) · ${r.docsPorStatus.correcao ?? 0} em correção`}
          icone={FileInput}
          href="/escritorio/documentos"
        />
        <Indicador
          rotulo="Entrega do checklist"
          valor={pctEntrega == null ? "—" : `${pctEntrega}%`}
          detalhe={`${itensOk} de ${totalItens} itens obrigatórios`}
          icone={ListChecks}
          tom={pctEntrega == null ? "neutro" : pctEntrega >= 100 ? "sucesso" : pctEntrega < 60 ? "alerta" : "neutro"}
        />
        <Indicador
          rotulo="Competências fechadas"
          valor={r.possiveisFechadas ? `${r.fechadas} de ${r.possiveisFechadas}` : "—"}
          detalhe="Meses encerrados do período × empresas"
          icone={CalendarCheck}
        />
        <Indicador
          rotulo="Itens atrasados agora"
          valor={atrasados}
          detalhe={`${comAtraso} empresa(s) com atraso`}
          icone={AlertTriangle}
          tom={atrasados ? "perigo" : "neutro"}
          href="/escritorio/pendencias?situacao=atraso"
        />
      </div>

      {!r.empresas.length ? (
        <EstadoVazio titulo="Nenhuma empresa encontrada" descricao="Altere os filtros ou verifique se você está vinculado às empresas da carteira." />
      ) : (
        <>
          <div className="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>Documentos recebidos por competência</CardTitle>
              </CardHeader>
              <CardContent>
                <GraficoBarras
                  formato="numero"
                  altura={240}
                  descricao="Gráfico de barras com a quantidade de documentos recebidos por competência"
                  dados={r.meses.map((_, i) => ({ rotulo: rotulosMes[i], documentos: r.docsPorMes[i] }))}
                  series={[{ chave: "documentos", rotulo: "Documentos", cor: 1 }]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Entrega do checklist</CardTitle>
                <CardDescription>Itens obrigatórios concluídos ou dispensados, na carteira.</CardDescription>
              </CardHeader>
              <CardContent>
                <GraficoLinhas
                  formato="percentual"
                  altura={240}
                  dominio={[0, 100]}
                  descricao="Gráfico de linha com o percentual de entrega do checklist por competência"
                  dados={r.entrega.porMes.map((m, i) => ({ rotulo: rotulosMes[i], entrega: percentualInteiro(m.ok, m.total) }))}
                  series={[{ chave: "entrega", rotulo: "Entrega", cor: 1 }]}
                />
              </CardContent>
            </Card>
          </div>

          <AbasLink
            ativa={aba}
            abas={(Object.keys(ABAS_ESCRITORIO) as (keyof typeof ABAS_ESCRITORIO)[]).map((k) => ({
              valor: k,
              rotulo: ABAS_ESCRITORIO[k],
              href: urlCom(aqui, {}, { ...filtros, aba: k }),
              contador: k === "pendencias" ? comAtraso : null,
            }))}
          />

          {aba === "pendencias" ? (
            <Table>
              <THead>
                <tr>
                  <Th>Empresa</Th>
                  <Th className="text-right">Atrasados</Th>
                  <Th className="text-right">Faltantes</Th>
                  <Th className="text-right">Em correção</Th>
                  <Th className="text-right">“Não se aplica”</Th>
                  <Th className="text-right">Fechamento</Th>
                  <Th className="text-right">Após fechamento</Th>
                </tr>
              </THead>
              <TBody>
                {r.pendencias.map((p) => {
                  const e = r.empresas.find((x) => x.id === p.empresaId)!;
                  const celula = (v: number, tom = "") => <Td className={cn("text-right numero", v ? tom : "text-muted-foreground")}>{v}</Td>;
                  return (
                    <Tr key={p.empresaId}>
                      <Td>
                        <Link href={`/e/${e.id}/pendencias`} className="font-medium text-titulo hover:underline">
                          {e.nome}
                        </Link>
                      </Td>
                      {celula(p.atrasados, "font-semibold text-perigo")}
                      {celula(p.faltantes)}
                      {celula(p.correcao, "text-perigo")}
                      {celula(p.naoAplicaRevisar, "text-alerta")}
                      {celula(p.fechamento, "text-alerta")}
                      {celula(p.aposFechamento, "text-alerta")}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th className="sticky left-0 bg-muted">Empresa</Th>
                  {rotulosMes.map((m) => (
                    <Th key={m} className="text-right">
                      {m}
                    </Th>
                  ))}
                  {aba === "documentos" ? <Th className="text-right">Total</Th> : null}
                </tr>
              </THead>
              <TBody>
                {r.empresas.map((e) => (
                  <Tr key={e.id}>
                    <Td className="sticky left-0 bg-card">
                      <Link href={`/e/${e.id}`} className="block max-w-64 truncate font-medium text-titulo hover:underline">
                        {e.nome}
                      </Link>
                      <span className="text-xs text-muted-foreground">{formatarDocumento(e.documento)}</span>
                    </Td>
                    {aba === "documentos" ? <LinhaDocumentos valores={r.docsMatriz.get(e.id) ?? r.meses.map(() => 0)} /> : null}
                    {aba === "checklist"
                      ? r.meses.map((m, i) => {
                          const c = r.entrega.porEmpresa.get(e.id)?.[i];
                          const p = c ? percentualInteiro(c.ok, c.total) : null;
                          return (
                            <Td key={m} className="text-right whitespace-nowrap numero">
                              <span className={cn("font-medium", tomPercentual(p))}>{p == null ? "—" : `${p}%`}</span>
                              {c?.total ? (
                                <span className="block text-xs text-muted-foreground">
                                  {c.ok}/{c.total}
                                </span>
                              ) : null}
                            </Td>
                          );
                        })
                      : null}
                    {aba === "fechamento"
                      ? r.meses.map((m, i) => {
                          const st = r.statusComp.get(e.id)?.[i] ?? "aberta";
                          return (
                            <Td key={m} className="text-right">
                              {m > r.mesAtual ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <Badge variante={STATUS_COMPETENCIA[st]?.tom ?? "neutro"}>{STATUS_COMPETENCIA[st]?.rotulo ?? st}</Badge>
                              )}
                            </Td>
                          );
                        })
                      : null}
                  </Tr>
                ))}
              </TBody>
              {aba !== "fechamento" ? (
                <TFoot>
                  <tr>
                    <Td className="sticky left-0 bg-muted">Carteira</Td>
                    {aba === "documentos" ? (
                      <>
                        {r.docsPorMes.map((v, i) => (
                          <Td key={r.meses[i]} className="text-right numero">
                            {v}
                          </Td>
                        ))}
                        <Td className="text-right numero">{r.totalDocs}</Td>
                      </>
                    ) : (
                      r.entrega.porMes.map((m, i) => {
                        const p = percentualInteiro(m.ok, m.total);
                        return (
                          <Td key={r.meses[i]} className="text-right whitespace-nowrap numero">
                            <span className={tomPercentual(p)}>{p == null ? "—" : `${p}%`}</span>
                            {m.empresas ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {m.completas}/{m.empresas} completas
                              </span>
                            ) : null}
                          </Td>
                        );
                      })
                    )}
                  </tr>
                </TFoot>
              ) : null}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {aba === "documentos"
              ? `Documentos enviados pelos clientes pela competência informada (arquivos ZIP contam uma vez). Situação no período: ${Object.entries(r.docsPorStatus)
                  .map(([st, q]) => `${STATUS_DOCUMENTO[st]?.rotulo ?? st}: ${q}`)
                  .join(" · ") || "nenhum documento"}.`
              : aba === "checklist"
                ? "Percentual de itens obrigatórios concluídos ou dispensados (“não se aplica” aprovado). “—”: checklist não gerado."
                : aba === "fechamento"
                  ? "Competências sem registro de fechamento aparecem como abertas."
                  : "Pendências atuais (independem do período): itens do checklist de qualquer competência, pendências de fechamento abertas e documentos recebidos após o fechamento ainda sem avaliação."}
          </p>
        </>
      )}
    </>
  );
}

function LinhaDocumentos({ valores }: { valores: number[] }) {
  const total = valores.reduce((t, v) => t + v, 0);
  return (
    <>
      {valores.map((v, i) => (
        <Td key={i} className={cn("text-right numero", !v && "text-muted-foreground")}>
          {v}
        </Td>
      ))}
      <Td className="text-right font-medium numero">{total}</Td>
    </>
  );
}
