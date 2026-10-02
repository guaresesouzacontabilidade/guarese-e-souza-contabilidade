import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Building2, CreditCard, FileSpreadsheet } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarDocumento, formatarRelativo } from "@/lib/formatos";

export const metadata: Metadata = { title: "Maquininhas" };

type Linha = {
  empresa_id: string;
  empresa: string;
  documento: string | null;
  contratos: number;
  vendas: number;
  bruto: number;
  taxas: number;
  acima: number;
  sem_taxa: number;
  aguardando: number;
  ultimo_relatorio: string | null;
};

const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toFixed(2).replace(".", ",")}%` : "—");

export default async function MaquininhasCarteira({ searchParams }: PageProps<"/escritorio/maquininhas">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const { data, error } = await s.supabase.rpc("maquininha_carteira", { p_inicio: comp, p_fim: ultimoDiaDoMes(comp) });
  const linhas = (data ?? []) as unknown as Linha[];
  const acima = linhas.reduce((t, l) => t + Number(l.acima), 0);
  const comAcima = linhas.filter((l) => Number(l.acima) > 0).length;
  const aguardando = linhas.reduce((t, l) => t + l.aguardando, 0);
  const bruto = linhas.reduce((t, l) => t + Number(l.bruto), 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Maquininhas"
        descricao="Taxas cobradas pelas adquirentes (cartão, frota, convênio e benefícios) comparadas com os contratos de cada empresa."
        acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês das vendas" />}
      />
      {error ? <Alerta tom="perigo" className="mb-4">Não foi possível carregar: {mensagemErro(error)}</Alerta> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Cobrado acima" valor={formatarMoeda(acima)} detalhe={`${comAcima} ${comAcima === 1 ? "empresa" : "empresas"}`} tom={acima > 0 ? "perigo" : "sucesso"} icone={AlertTriangle} />
        <Indicador rotulo="Vendas conferidas" valor={formatarMoeda(bruto)} detalhe={formatarCompetencia(comp, true)} icone={CreditCard} />
        <Indicador rotulo="Relatórios para conferir" valor={aguardando} detalhe="formatos novos (uma vez por formato)" tom={aguardando ? "alerta" : "neutro"} icone={FileSpreadsheet} />
        <Indicador rotulo="Empresas" valor={linhas.length} detalhe="com contrato ou relatório" icone={Building2} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Empresas</CardTitle>
          <CardDescription>Ordenadas pelo valor cobrado acima do contrato no mês.</CardDescription>
        </CardHeader>
        <CardContent>
          {linhas.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th className="hidden text-right md:table-cell">Vendas</Th>
                  <Th className="hidden text-right sm:table-cell">Taxas</Th>
                  <Th className="text-right">Acima do contrato</Th>
                  <Th className="hidden lg:table-cell">Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.empresa_id}>
                    <Td>
                      <Link href={`/e/${l.empresa_id}/maquininhas?competencia=${comp.slice(0, 7)}`} className="font-medium text-primary hover:underline">
                        {l.empresa}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatarDocumento(l.documento)}
                        {l.ultimo_relatorio ? ` · último relatório ${formatarRelativo(l.ultimo_relatorio)}` : ""}
                      </span>
                    </Td>
                    <Td className="hidden text-right numero md:table-cell">
                      {formatarMoeda(l.bruto)}
                      <span className="block text-xs text-muted-foreground">{l.vendas.toLocaleString("pt-BR")} vendas</span>
                    </Td>
                    <Td className="hidden text-right numero sm:table-cell">
                      {formatarMoeda(l.taxas)}
                      <span className="block text-xs text-muted-foreground">{pct(Number(l.taxas), Number(l.bruto))}</span>
                    </Td>
                    <Td className={Number(l.acima) > 0 ? "text-right numero font-semibold text-perigo" : "text-right numero text-muted-foreground"}>
                      {Number(l.acima) > 0 ? formatarMoeda(l.acima) : "—"}
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {!l.contratos ? <Badge variante="alerta">sem contrato</Badge> : null}
                        {l.aguardando ? <Badge variante="alerta">{l.aguardando} para conferir</Badge> : null}
                        {l.sem_taxa ? <Badge variante="neutro">{l.sem_taxa} sem taxa</Badge> : null}
                        {l.contratos && !l.aguardando && !l.sem_taxa ? <Badge variante="sucesso">em dia</Badge> : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={CreditCard}
              titulo="Nenhuma empresa com maquininha cadastrada"
              descricao="Cadastre os contratos na página Maquininhas de cada empresa ou peça aos clientes que enviem os relatórios de vendas da adquirente (CSV ou Excel)."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
