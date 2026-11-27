import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcoesContrato, AcoesTaxa, NovaTaxa, NovoContrato, type Adquirente, type Contrato, type Taxa } from "@/components/maquininhas/contratos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { MODALIDADES, ROTULO_MODALIDADE, ROTULO_TIPO_ADQUIRENTE, rotuloFaixaParcelas, type Modalidade } from "@/lib/maquininhas/rotulos";

export const metadata: Metadata = { title: "Contratos das maquininhas" };

const ordemModalidade = (m: string) => MODALIDADES.indexOf(m as Modalidade);

export default async function ContratosMaquininhas({ params }: PageProps<"/e/[empresaId]/maquininhas/contratos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("maquininhas.ver")) return <Alerta tom="alerta">Seu acesso não inclui a conferência das maquininhas desta empresa.</Alerta>;
  const gerenciar = ctx.pode("maquininhas.gerenciar");
  const [{ data: catalogo }, { data: contratos }] = await Promise.all([
    ctx.supabase.from("maquininha_adquirentes").select("codigo, nome, tipo").eq("ativo", true).order("ordem").order("nome"),
    ctx.supabase
      .from("maquininha_contratos")
      .select(
        "id, adquirente_codigo, adquirente_nome, tipo, apelido, codigo_estabelecimento, vigencia_inicio, vigencia_fim, aluguel_mensal, observacao, ativo, taxas:maquininha_taxas(id, bandeira, modalidade, parcelas_de, parcelas_ate, taxa_percentual, tarifa_fixa, prazo_dias, observacao)",
      )
      .eq("empresa_id", empresaId)
      .order("ativo", { ascending: false })
      .order("adquirente_nome")
      .order("vigencia_inicio", { ascending: false }),
  ]);
  const lista = (catalogo ?? []) as Adquirente[];

  return (
    <>
      <CabecalhoPagina
        titulo="Contratos e taxas"
        descricao="As taxas combinadas com cada adquirente. Uma venda é conferida com o contrato vigente na data dela; a taxa de uma bandeira específica vale mais que a de todas as bandeiras."
        voltar={{ href: `/e/${empresaId}/maquininhas`, rotulo: "Voltar às maquininhas" }}
        acoes={gerenciar ? <NovoContrato empresaId={empresaId} catalogo={lista} /> : null}
      />
      <Alerta tom="info" className="mb-4">
        Informe a taxa total de cada tipo de venda. Se a adquirente antecipa os recebimentos automaticamente, some a taxa de antecipação: o portal compara
        com a diferença entre o valor da venda e o valor líquido.
      </Alerta>
      {contratos?.length ? (
        <div className="space-y-4">
          {contratos.map((c) => {
            const contrato = c as unknown as Contrato & { taxas: Taxa[] };
            const taxas = [...contrato.taxas].sort(
              (a, b) =>
                ordemModalidade(a.modalidade) - ordemModalidade(b.modalidade) ||
                (a.bandeira ?? "").localeCompare(b.bandeira ?? "") ||
                a.parcelas_de - b.parcelas_de,
            );
            return (
              <Card key={contrato.id} className={contrato.ativo ? undefined : "opacity-70"}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {contrato.adquirente_nome}
                      {contrato.apelido ? <span className="text-sm font-normal text-muted-foreground">· {contrato.apelido}</span> : null}
                      <Badge variante="contorno">{ROTULO_TIPO_ADQUIRENTE[contrato.tipo]}</Badge>
                      {!contrato.ativo ? <Badge variante="neutro">Inativo</Badge> : null}
                    </CardTitle>
                    <CardDescription>
                      Taxas desde {formatarData(contrato.vigencia_inicio)}
                      {contrato.vigencia_fim ? ` até ${formatarData(contrato.vigencia_fim)}` : ""}
                      {contrato.aluguel_mensal ? ` · aluguel ${formatarMoeda(contrato.aluguel_mensal)}/mês` : ""}
                      {contrato.codigo_estabelecimento ? ` · estabelecimento ${contrato.codigo_estabelecimento}` : ""}
                    </CardDescription>
                    {contrato.observacao ? <p className="mt-1 text-xs text-muted-foreground">{contrato.observacao}</p> : null}
                  </div>
                  {gerenciar ? (
                    <div className="flex items-center gap-1">
                      <NovaTaxa empresaId={empresaId} contrato={contrato} />
                      <AcoesContrato empresaId={empresaId} contrato={contrato} catalogo={lista} />
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {taxas.length ? (
                    <Table>
                      <THead>
                        <Tr>
                          <Th>Tipo de venda</Th>
                          <Th>Bandeira</Th>
                          <Th className="text-right">Taxa</Th>
                          <Th className="hidden text-right sm:table-cell">Tarifa por venda</Th>
                          <Th className="hidden text-right md:table-cell">Recebimento</Th>
                          {gerenciar ? <Th className="w-12" /> : null}
                        </Tr>
                      </THead>
                      <TBody>
                        {taxas.map((t) => (
                          <Tr key={t.id}>
                            <Td>
                              {ROTULO_MODALIDADE[t.modalidade as Modalidade] ?? t.modalidade}
                              {t.modalidade === "credito_parcelado" ? ` ${rotuloFaixaParcelas(t.parcelas_de, t.parcelas_ate)}` : ""}
                              {t.observacao ? <span className="block text-xs text-muted-foreground">{t.observacao}</span> : null}
                            </Td>
                            <Td>{t.bandeira ?? <span className="text-muted-foreground">Todas</span>}</Td>
                            <Td className="text-right numero font-medium">{String(t.taxa_percentual).replace(".", ",")}%</Td>
                            <Td className="hidden text-right numero sm:table-cell">{Number(t.tarifa_fixa) ? formatarMoeda(t.tarifa_fixa) : "—"}</Td>
                            <Td className="hidden text-right md:table-cell">{t.prazo_dias !== null ? `${t.prazo_dias} ${t.prazo_dias === 1 ? "dia" : "dias"}` : "—"}</Td>
                            {gerenciar ? (
                              <Td>
                                <AcoesTaxa empresaId={empresaId} contratoId={contrato.id} taxa={t} />
                              </Td>
                            ) : null}
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma taxa cadastrada: as vendas desta adquirente ficam como &ldquo;sem taxa&rdquo;.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EstadoVazio
          icone={Receipt}
          titulo="Nenhum contrato cadastrado"
          descricao={
            gerenciar
              ? "Cadastre a maquininha de cada adquirente (cartão, frota, convênio ou benefícios) com as taxas combinadas."
              : "O escritório ou o responsável pela empresa cadastra os contratos das maquininhas."
          }
          acao={gerenciar ? <NovoContrato empresaId={empresaId} catalogo={lista} /> : undefined}
        />
      )}
    </>
  );
}
