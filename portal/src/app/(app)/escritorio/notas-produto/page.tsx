import type { Metadata } from "next";
import Link from "next/link";
import { Building2, FileText, PlugZap, Receipt } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { competenciaAtual, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Notas de produto emitidas" };

type Linha = {
  empresa_id: string;
  empresa: string;
  documento: string | null;
  ativa: boolean;
  ambiente: "homologacao" | "producao" | null;
  certificado_valido_ate: string | null;
  autorizadas: number;
  valor: number;
  canceladas: number;
  rejeitadas: number;
  pendentes: number;
  guias_a_gerar: number;
  testes: number;
};

export default async function NotasProdutoCarteira({ searchParams }: PageProps<"/escritorio/notas-produto">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? competenciaAtual();
  const { data, error } = await s.supabase.rpc("nfe_carteira", { p_inicio: comp, p_fim: ultimoDiaDoMes(comp) });
  const linhas = (data ?? []) as unknown as Linha[];
  const ligadas = linhas.filter((l) => l.ativa).length;
  const total = linhas.reduce((t, l) => t + Number(l.valor), 0);
  const problemas = linhas.reduce((t, l) => t + l.rejeitadas + l.pendentes, 0);
  const guias = linhas.reduce((t, l) => t + l.guias_a_gerar, 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Notas de produto emitidas"
        descricao="Emissão de NF-e pelo portal em cada empresa: notas do mês, recusas, guias de ICMS a gerar e a situação da configuração."
        acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês" />}
      />
      {error ? <Alerta tom="perigo">Não foi possível carregar: {mensagemErro(error)}</Alerta> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Empresas com emissão ligada" valor={ligadas} icone={Building2} />
        <Indicador rotulo="Valor autorizado no mês" valor={formatarMoeda(total)} tom="sucesso" icone={FileText} detalhe="Só notas de produção." />
        <Indicador rotulo="Recusadas ou pendentes" valor={problemas} tom={problemas ? "alerta" : "neutro"} />
        <Indicador rotulo="Guias a gerar (todas)" valor={guias} tom={guias ? "alerta" : "neutro"} icone={Receipt} detalhe="ICMS, frete, DIFAL e contribuições." />
      </div>
      <Card>
        <CardContent className="p-0 sm:p-0">
          {linhas.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Emissão</Th>
                  <Th className="text-right">Notas</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="hidden md:table-cell">Recusadas / pendentes</Th>
                  <Th className="hidden md:table-cell">Guias a gerar</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.empresa_id}>
                    <Td>
                      <Link href={`/e/${l.empresa_id}/notas-produto?competencia=${comp.slice(0, 7)}`} className="font-medium underline-offset-4 hover:underline">
                        {l.empresa}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{formatarDocumento(l.documento)}</span>
                    </Td>
                    <Td>
                      {l.ativa ? (
                        <Badge variante={l.ambiente === "producao" ? "sucesso" : "info"}>{l.ambiente === "producao" ? "Produção" : "Teste"}</Badge>
                      ) : (
                        <Badge>Desligada</Badge>
                      )}
                      {l.certificado_valido_ate ? (
                        <span className="block text-xs text-muted-foreground">Certificado até {formatarData(l.certificado_valido_ate)}</span>
                      ) : (
                        <span className="block text-xs text-alerta">Sem certificado</span>
                      )}
                    </Td>
                    <Td className="text-right numero">
                      {l.autorizadas}
                      {l.canceladas ? <span className="block text-xs text-muted-foreground">{l.canceladas} cancelada(s)</span> : null}
                      {l.testes ? <span className="block text-xs text-muted-foreground">{l.testes} de teste</span> : null}
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(l.valor)}</Td>
                    <Td className="hidden md:table-cell">
                      {l.rejeitadas || l.pendentes ? (
                        <Badge variante="alerta">
                          {l.rejeitadas} / {l.pendentes}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="hidden md:table-cell">{l.guias_a_gerar ? <Badge variante="alerta">{l.guias_a_gerar}</Badge> : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={PlugZap}
              titulo="Nenhuma empresa com emissão de NF-e configurada"
              descricao="Abra uma empresa, vá em Notas de produto (NF-e) → Configurar emissão, cadastre a inscrição, as operações e os produtos e ligue a emissão (com o certificado digital)."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
