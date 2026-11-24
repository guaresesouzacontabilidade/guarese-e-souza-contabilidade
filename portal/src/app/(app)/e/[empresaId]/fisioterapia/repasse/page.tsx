import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, HandCoins } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { hojeClinica } from "@/lib/veterinaria/contexto";
import { formatarCompetencia } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";

export const metadata: Metadata = { title: "Repasse dos fisioterapeutas" };

function somarMes(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default async function PaginaRepasse({ params, searchParams }: PageProps<"/e/[empresaId]/fisioterapia/repasse">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.gerente) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hojeClinica().slice(0, 7);
  const base = `/e/${empresaId}/fisioterapia`;
  const { data: linhas, error } = await ctx.supabase.rpc("fisio_repasse", { p_empresa_id: empresaId, p_mes: `${mes}-01` });
  const total = (linhas ?? []).reduce((s, l) => s + Number(l.repasse), 0);
  const valor = (linhas ?? []).reduce((s, l) => s + Number(l.valor_sessoes), 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Repasse dos fisioterapeutas"
        descricao="Sessões e avaliações realizadas no mês por fisioterapeuta e o valor a repassar (percentual de cada um sobre o valor das sessões)."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
      />
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Mês anterior">
          <Link href={`${base}/repasse?mes=${somarMes(mes, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <span className="min-w-36 text-center font-semibold capitalize">{formatarCompetencia(`${mes}-01`, true)}</span>
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Próximo mês">
          <Link href={`${base}/repasse?mes=${somarMes(mes, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
      </div>
      {error ? <Alerta tom="perigo">{error.message}</Alerta> : null}
      {linhas?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Fisioterapeuta</Th>
                  <Th className="text-right">Sessões</Th>
                  <Th className="hidden text-right sm:table-cell">Avaliações</Th>
                  <Th className="hidden text-right sm:table-cell">Faltas</Th>
                  <Th className="hidden text-right md:table-cell">Valor das sessões</Th>
                  <Th className="text-right">Repasse</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.profissional_id}>
                    <Td className="font-medium">{l.nome}</Td>
                    <Td className="numero text-right">{l.sessoes}</Td>
                    <Td className="numero hidden text-right sm:table-cell">{l.avaliacoes}</Td>
                    <Td className="numero hidden text-right sm:table-cell">{l.faltas}</Td>
                    <Td className="numero hidden text-right md:table-cell">{formatarMoeda(l.valor_sessoes)}</Td>
                    <Td className="numero text-right">
                      {formatarMoeda(l.repasse)}
                      <span className="block text-xs text-muted-foreground">{String(l.repasse_percentual).replace(".", ",")}%</span>
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  <Td />
                  <Td className="hidden sm:table-cell" />
                  <Td className="hidden sm:table-cell" />
                  <Td className="numero hidden text-right font-semibold md:table-cell">{formatarMoeda(valor)}</Td>
                  <Td className="numero text-right font-semibold">{formatarMoeda(total)}</Td>
                </Tr>
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={HandCoins} titulo="Nenhum fisioterapeuta cadastrado" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Valor de cada sessão: o do pacote dividido pelo número de sessões; sem pacote, o valor da sessão avulsa (Configurações da clínica). O pagamento do repasse é lançado
        no Financeiro como despesa.
      </p>
    </>
  );
}
