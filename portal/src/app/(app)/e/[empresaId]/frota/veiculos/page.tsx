import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DialogoVeiculo } from "@/components/frota/lancamentos";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { formatarMoeda } from "@/lib/dinheiro";
import { CAMPOS_VEICULO } from "@/lib/frota/dados";

export const metadata: Metadata = { title: "Veículos da frota" };

const TIPOS: Record<string, string> = { cavalo: "Cavalo mecânico", truck: "Truck", toco: "Toco", carreta: "Carreta", utilitario: "Utilitário", outro: "Outro" };

export default async function PaginaVeiculos({ params }: PageProps<"/e/[empresaId]/frota/veiculos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) notFound();
  const podeEditar = ctx.pode("financeiro.editar");
  const { data } = await ctx.supabase.from("frota_veiculos").select(CAMPOS_VEICULO).eq("empresa_id", empresaId).order("ativo", { ascending: false }).order("placa");
  const veiculos = data ?? [];
  return (
    <>
      <CabecalhoPagina
        titulo="Veículos da frota"
        descricao="Cada veículo com os custos fixos do mês. Eles entram no resultado líquido, inclusive nos meses sem viagem."
        voltar={{ href: `/e/${empresaId}/frota`, rotulo: "Rentabilidade da frota" }}
        acoes={podeEditar ? <DialogoVeiculo empresaId={empresaId} /> : null}
      />
      <Card>
        <CardContent className="pt-5">
          {veiculos.length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Placa</Th>
                    <Th>Caminhão</Th>
                    <Th className="text-right">Motorista (salário + encargos)</Th>
                    <Th className="text-right">Parcela + depreciação</Th>
                    <Th className="text-right">Seguro e outros</Th>
                    <Th className="text-right">Custo fixo do mês</Th>
                    {podeEditar ? <Th /> : null}
                  </tr>
                </THead>
                <TBody>
                  {veiculos.map((v) => {
                    const fixo = Number(v.custo_motorista_mensal) + Number(v.financiamento_mensal) + Number(v.depreciacao_mensal) + Number(v.seguro_mensal) + Number(v.outros_fixos_mensal);
                    return (
                      <Tr key={v.id}>
                        <Td className="font-semibold numero">
                          {v.placa.slice(0, 3)}-{v.placa.slice(3)}
                          {!v.ativo ? (
                            <Badge variante="neutro" className="ml-2">
                              Fora de uso
                            </Badge>
                          ) : null}
                        </Td>
                        <Td>
                          {v.descricao}
                          <span className="block text-xs text-muted-foreground">{TIPOS[v.tipo] ?? v.tipo}</span>
                        </Td>
                        <Td className="text-right numero">{formatarMoeda(v.custo_motorista_mensal)}</Td>
                        <Td className="text-right numero">{formatarMoeda(Number(v.financiamento_mensal) + Number(v.depreciacao_mensal))}</Td>
                        <Td className="text-right numero">{formatarMoeda(Number(v.seguro_mensal) + Number(v.outros_fixos_mensal))}</Td>
                        <Td className="text-right numero font-semibold">{formatarMoeda(fixo)}</Td>
                        {podeEditar ? (
                          <Td className="text-right">
                            <DialogoVeiculo empresaId={empresaId} veiculo={{ ...v, km_inicial: v.km_inicial === null ? null : String(v.km_inicial) }} />
                          </Td>
                        ) : null}
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ) : (
            <EstadoVazio icone={Truck} titulo="Nenhum veículo cadastrado" descricao="Cadastre o primeiro veículo para começar." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
