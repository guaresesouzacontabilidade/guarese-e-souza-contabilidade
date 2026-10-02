import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BadgePercent, CreditCard, Download, FileSpreadsheet, PlugZap, Receipt, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { competenciaAtual, competenciaDe, lerCompetencia, listaCompetencias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarRelativo } from "@/lib/formatos";
import { ROTULO_MODALIDADE, SITUACAO_IMPORTACAO, type Modalidade } from "@/lib/maquininhas/rotulos";

export const metadata: Metadata = { title: "Maquininhas" };

type Totais = { vendas: number; bruto: number; taxas: number; acima: number; vendas_acima: number; abaixo: number; sem_taxa: number; canceladas: number };
type Grupo = {
  adquirente_chave: string;
  adquirente: string;
  bandeira: string;
  modalidade: Modalidade;
  parcelas: number;
  vendas: number;
  bruto: number;
  taxas: number;
  esperado: number | null;
  taxa_contratada: number | null;
  tarifa_contratada: number | null;
  acima: number;
  vendas_acima: number;
  sem_taxa: number;
  sem_contrato: boolean;
};
type Maior = {
  id: number;
  data: string;
  bandeira: string | null;
  modalidade: Modalidade;
  parcelas: number;
  bruto: number;
  taxa: number;
  esperado: number;
  diferenca: number;
  taxa_contratada: number;
  nsu: string | null;
  autorizacao: string | null;
  adquirente_chave: string;
};
type Resumo = { totais: Totais; grupos: Grupo[]; maiores: Maior[] };

const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toFixed(2).replace(".", ",")}%` : "—");
const modalidadeTexto = (m: Modalidade, parcelas: number) => `${ROTULO_MODALIDADE[m] ?? m}${m === "credito_parcelado" ? ` ${parcelas}x` : ""}`;

export default async function Maquininhas({ params, searchParams }: PageProps<"/e/[empresaId]/maquininhas">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("maquininhas.ver")) return <Alerta tom="alerta">Seu acesso não inclui a conferência das maquininhas desta empresa.</Alerta>;
  const gerenciar = ctx.pode("maquininhas.gerenciar");
  const base = `/e/${empresaId}`;

  let comp = lerCompetencia(parametro(sp, "competencia"));
  if (!comp) {
    const { data: ultima } = await ctx.supabase
      .from("maquininha_vendas")
      .select("data_venda")
      .eq("empresa_id", empresaId)
      .order("data_venda", { ascending: false })
      .limit(1)
      .maybeSingle();
    comp = ultima ? competenciaDe(ultima.data_venda) : somarMeses(competenciaAtual(), -1);
  }
  const fim = ultimoDiaDoMes(comp);

  const [{ data, error }, { data: relatorios }, { count: contratos }] = await Promise.all([
    ctx.supabase.rpc("maquininha_resumo", { p_empresa_id: empresaId, p_inicio: comp, p_fim: fim }),
    ctx.supabase
      .from("maquininha_importacoes")
      .select("id, nome_arquivo, situacao, adquirente_nome, periodo_inicio, periodo_fim, vendas, total_acima, erro, created_at, documento_id")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.supabase.from("maquininha_contratos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar a conferência: {mensagemErro(error)}</Alerta>;
  const r = data as unknown as Resumo;
  const t = r.totais;
  const nomes = new Map(r.grupos.map((g) => [g.adquirente_chave, g.adquirente]));
  const aguardando = (relatorios ?? []).filter((i) => i.situacao === "aguardando_mapeamento");
  const comErro = (relatorios ?? []).filter((i) => i.situacao === "erro");
  const andamento = (relatorios ?? []).some((i) => i.situacao === "na_fila" || i.situacao === "importando");

  return (
    <>
      <CabecalhoPagina
        titulo="Maquininhas"
        descricao="Confere a taxa cobrada em cada venda (cartão, frota, convênio e benefícios) com a taxa do contrato de cada adquirente."
        acoes={
          <>
            <SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês das vendas" />
            {ctx.pode("documentos.enviar") ? (
              <Button asChild>
                <Link href={`${base}/enviar?categoria=relatorio_maquininha`}>
                  <Upload /> Enviar relatório
                </Link>
              </Button>
            ) : null}
            <Button asChild variante="contorno">
              <Link href={`${base}/maquininhas/contratos`}>
                <Receipt /> Contratos e taxas
              </Link>
            </Button>
          </>
        }
      />
      <AtualizarEnquanto ativo={andamento} />

      {aguardando.length ? (
        <Alerta tom="alerta" className="mb-4" titulo={aguardando.length === 1 ? "Um relatório em formato novo" : `${aguardando.length} relatórios em formato novo`}>
          {gerenciar ? "Confira as colunas uma vez; os próximos relatórios iguais entram sozinhos: " : "O escritório vai conferir as colunas e importar: "}
          {aguardando.map((i, n) => (
            <span key={i.id}>
              {n ? ", " : ""}
              <Link href={`${base}/maquininhas/importacoes/${i.id}`} className="font-medium underline">
                {i.nome_arquivo ?? "relatório"}
              </Link>
            </span>
          ))}
          .
        </Alerta>
      ) : null}
      {comErro.length ? (
        <Alerta tom="perigo" className="mb-4" titulo="Relatório com erro na leitura">
          {comErro.map((i) => (
            <span key={i.id} className="block">
              <Link href={`${base}/maquininhas/importacoes/${i.id}`} className="font-medium underline">
                {i.nome_arquivo ?? "relatório"}
              </Link>
              : {i.erro}
            </span>
          ))}
        </Alerta>
      ) : null}
      {!contratos ? (
        <Alerta tom="info" className="mb-4" titulo="Cadastre o contrato de cada maquininha">
          Sem as taxas combinadas, o portal mostra o que foi cobrado, mas não tem com o que comparar.{" "}
          {gerenciar ? (
            <Link href={`${base}/maquininhas/contratos`} className="font-medium underline">
              Cadastrar contrato
            </Link>
          ) : (
            "Peça ao escritório ou ao responsável pela empresa."
          )}
        </Alerta>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Vendas no mês" valor={formatarMoeda(t.bruto)} detalhe={`${t.vendas.toLocaleString("pt-BR")} vendas aprovadas`} icone={CreditCard} />
        <Indicador rotulo="Taxas cobradas" valor={formatarMoeda(t.taxas)} detalhe={`taxa média de ${pct(t.taxas, t.bruto)}`} icone={BadgePercent} />
        <Indicador
          rotulo="Cobrado acima do contrato"
          valor={formatarMoeda(t.acima)}
          detalhe={t.vendas_acima ? `${t.vendas_acima.toLocaleString("pt-BR")} ${t.vendas_acima === 1 ? "venda" : "vendas"}` : "nenhuma venda"}
          tom={t.acima > 0 ? "perigo" : "sucesso"}
          icone={AlertTriangle}
        />
        <Indicador
          rotulo="Sem taxa para conferir"
          valor={t.sem_taxa.toLocaleString("pt-BR")}
          detalhe="vendas sem contrato ou sem a taxa daquele tipo"
          tom={t.sem_taxa ? "alerta" : "neutro"}
          icone={Receipt}
          href={`${base}/maquininhas/contratos`}
        />
      </div>

      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Taxas de {formatarCompetencia(comp, true)}</CardTitle>
            <CardDescription>Por adquirente, bandeira e tipo de venda. A taxa cobrada é a diferença entre o valor da venda e o valor líquido.</CardDescription>
          </div>
          {r.grupos.length ? (
            <Button asChild variante="contorno" tamanho="sm">
              <a href={`/api/maquininhas/${empresaId}?competencia=${comp.slice(0, 7)}`}>
                <Download /> Baixar planilha
              </a>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {r.grupos.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Adquirente</Th>
                  <Th className="hidden sm:table-cell">Bandeira</Th>
                  <Th className="hidden sm:table-cell">Tipo de venda</Th>
                  <Th className="hidden text-right md:table-cell">Vendas</Th>
                  <Th className="hidden text-right sm:table-cell">Valor</Th>
                  <Th className="text-right">Taxa cobrada</Th>
                  <Th className="hidden text-right sm:table-cell">Contrato</Th>
                  <Th className="text-right">A mais</Th>
                </Tr>
              </THead>
              <TBody>
                {r.grupos.map((g) => (
                  <Tr key={`${g.adquirente_chave}|${g.bandeira}|${g.modalidade}|${g.parcelas}`}>
                    <Td className="font-medium">
                      {g.adquirente}
                      <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                        {g.bandeira} · {modalidadeTexto(g.modalidade, g.parcelas)}
                      </span>
                    </Td>
                    <Td className="hidden sm:table-cell">{g.bandeira}</Td>
                    <Td className="hidden sm:table-cell">{modalidadeTexto(g.modalidade, g.parcelas)}</Td>
                    <Td className="hidden text-right numero md:table-cell">{g.vendas.toLocaleString("pt-BR")}</Td>
                    <Td className="hidden text-right numero whitespace-nowrap sm:table-cell">{formatarMoeda(g.bruto)}</Td>
                    <Td className="text-right numero whitespace-nowrap">
                      {formatarMoeda(g.taxas)} <span className="block text-xs text-muted-foreground">{pct(g.taxas, g.bruto)}</span>
                    </Td>
                    <Td className="hidden text-right sm:table-cell">
                      {g.taxa_contratada !== null ? (
                        <span className="numero">
                          {String(g.taxa_contratada).replace(".", ",")}%
                          {g.tarifa_contratada ? <span className="block text-xs text-muted-foreground">+ {formatarMoeda(g.tarifa_contratada)}</span> : null}
                        </span>
                      ) : (
                        <Badge variante="alerta">{g.sem_contrato ? "sem contrato" : "sem taxa"}</Badge>
                      )}
                    </Td>
                    <Td className={g.acima > 0 ? "whitespace-nowrap text-right numero font-semibold text-perigo" : "text-right numero text-muted-foreground"}>
                      {g.acima > 0 ? formatarMoeda(g.acima) : "—"}
                      {g.vendas_acima ? (
                        <span className="block text-xs font-normal">
                          {g.vendas_acima} {g.vendas_acima === 1 ? "venda" : "vendas"}
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={FileSpreadsheet}
              titulo={`Nenhuma venda em ${formatarCompetencia(comp, true)}`}
              descricao="Baixe o relatório de vendas no site ou aplicativo da adquirente (em CSV ou Excel) e envie em Documentos, no tipo “Relatórios de maquininhas”."
            />
          )}
        </CardContent>
      </Card>

      {r.maiores.length ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Vendas com taxa acima do contrato</CardTitle>
            <CardDescription>
              As maiores diferenças do mês{r.maiores.length === 100 ? " (as 100 maiores; a planilha traz todas)" : ""}. Use esta lista para pedir a devolução à adquirente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th className="hidden sm:table-cell">Data</Th>
                  <Th className="hidden md:table-cell">Adquirente</Th>
                  <Th>Venda</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="hidden text-right sm:table-cell">Cobrado</Th>
                  <Th className="hidden text-right sm:table-cell">Pelo contrato</Th>
                  <Th className="text-right">A mais</Th>
                </Tr>
              </THead>
              <TBody>
                {r.maiores.map((v) => (
                  <Tr key={v.id}>
                    <Td className="hidden sm:table-cell">{formatarData(v.data)}</Td>
                    <Td className="hidden md:table-cell">{nomes.get(v.adquirente_chave) ?? "—"}</Td>
                    <Td>
                      <span className="block text-xs text-muted-foreground sm:hidden">{formatarData(v.data)}</span>
                      {v.bandeira ?? "—"} · {modalidadeTexto(v.modalidade, v.parcelas)}
                      {v.nsu || v.autorizacao ? <span className="block text-xs text-muted-foreground">{v.nsu ? `NSU ${v.nsu}` : `Aut. ${v.autorizacao}`}</span> : null}
                    </Td>
                    <Td className="text-right numero whitespace-nowrap">{formatarMoeda(v.bruto)}</Td>
                    <Td className="hidden text-right numero sm:table-cell">
                      {formatarMoeda(v.taxa)} <span className="block text-xs text-muted-foreground">{pct(v.taxa, v.bruto)}</span>
                    </Td>
                    <Td className="hidden text-right numero sm:table-cell">
                      {formatarMoeda(v.esperado)} <span className="block text-xs text-muted-foreground">{String(v.taxa_contratada).replace(".", ",")}%</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right numero font-semibold text-perigo">{formatarMoeda(v.diferenca)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Relatórios recebidos</CardTitle>
            <CardDescription>A mesma venda em dois relatórios (semanal e mensal, por exemplo) conta uma vez só.</CardDescription>
          </CardHeader>
          <CardContent>
            {relatorios?.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Arquivo</Th>
                    <Th className="hidden md:table-cell">Período</Th>
                    <Th className="hidden text-right sm:table-cell">Vendas</Th>
                    <Th>Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {relatorios.map((i) => {
                    const s = SITUACAO_IMPORTACAO[i.situacao] ?? { rotulo: i.situacao, variante: "neutro" as const };
                    return (
                      <Tr key={i.id}>
                        <Td>
                          <Link href={`${base}/maquininhas/importacoes/${i.id}`} className="font-medium text-primary hover:underline">
                            {i.nome_arquivo ?? "Relatório"}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {i.adquirente_nome ?? "adquirente a definir"} · recebido {formatarRelativo(i.created_at)}
                          </span>
                        </Td>
                        <Td className="hidden md:table-cell">
                          {i.periodo_inicio ? `${formatarData(i.periodo_inicio)} a ${formatarData(i.periodo_fim)}` : "—"}
                        </Td>
                        <Td className="hidden text-right numero sm:table-cell">{i.vendas?.toLocaleString("pt-BR") ?? "—"}</Td>
                        <Td>
                          <Badge variante={s.variante}>{s.rotulo}</Badge>
                          {Number(i.total_acima ?? 0) > 0 ? <span className="block text-xs text-perigo">{formatarMoeda(i.total_acima)} a mais</span> : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum relatório ainda.</p>
            )}
          </CardContent>
        </Card>
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Como funciona</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>1. Cadastre o contrato de cada maquininha com as taxas combinadas (por tipo de venda e, se for o caso, por bandeira).</p>
              <p>2. Todo mês, baixe o relatório de vendas no site da adquirente (CSV ou Excel) e envie em Documentos.</p>
              <p>3. O portal confere cada venda e avisa quando a taxa cobrada passou do combinado.</p>
              <p className="text-xs">Vale para cartões, frota e combustível, convênios e vales-refeição/alimentação. Relatórios em PDF não são lidos.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-4" /> Conexão direta com as adquirentes
              </CardTitle>
              <CardDescription>
                <Badge variante="neutro">Desconectada</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A busca automática das vendas (EDI ou API) depende de cada adquirente liberar o acesso para o CNPJ da empresa. Até lá, o portal usa só os
              relatórios enviados — nenhuma consulta é feita às adquirentes.
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
