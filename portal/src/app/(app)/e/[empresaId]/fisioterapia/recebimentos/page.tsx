import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ReceiptText, RotateCcw } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { DialogoMotivo, FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { DialogoRecebimento } from "@/components/fisioterapia/cadastros";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { estornarRecebimento } from "@/lib/fisioterapia/acoes";
import { hojeClinica } from "@/lib/veterinaria/contexto";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { FORMAS_RECEBIMENTO } from "@/lib/fisioterapia/rotulos";
import { opcoesClinica } from "../dados";

export const metadata: Metadata = { title: "Recebimentos da clínica" };

function somarMes(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function PaginaRecebimentosFisio({ params, searchParams }: PageProps<"/e/[empresaId]/fisioterapia/recebimentos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoje.slice(0, 7);
  const base = `/e/${empresaId}/fisioterapia`;
  const [{ data: lista }, opcoes] = await Promise.all([
    ctx.supabase
      .from("fisio_recebimentos")
      .select("id, data, descricao, forma, valor, vencimento, cancelado_em, cancelado_motivo, paciente:fisio_pacientes(id, nome)")
      .eq("empresa_id", empresaId)
      .gte("data", `${mes}-01`)
      .lt("data", `${somarMes(mes, 1)}-01`)
      .order("data", { ascending: false })
      .order("created_at", { ascending: false }),
    opcoesClinica(ctx, empresaId),
  ]);
  const validos = (lista ?? []).filter((r) => !r.cancelado_em);
  const recebido = validos.filter((r) => r.forma !== "a_receber").reduce((s, r) => s + Number(r.valor), 0);
  const aReceber = validos.filter((r) => r.forma === "a_receber").reduce((s, r) => s + Number(r.valor), 0);
  const porForma = new Map<string, number>();
  for (const r of validos) porForma.set(r.forma, (porForma.get(r.forma) ?? 0) + Number(r.valor));

  return (
    <>
      <CabecalhoPagina
        titulo="Recebimentos"
        descricao="Tudo o que a recepção recebe entra sozinho no Financeiro da empresa e chega pronto para a contabilidade."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
        acoes={<DialogoRecebimento empresaId={empresaId} pacientes={opcoes.pacientes} />}
      />
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Mês anterior">
          <Link href={`${base}/recebimentos?mes=${somarMes(mes, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <span className="min-w-36 text-center font-semibold capitalize">{formatarCompetencia(`${mes}-01`, true)}</span>
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Próximo mês">
          <Link href={`${base}/recebimentos?mes=${somarMes(mes, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Recebido no mês" valor={formatarMoeda(recebido)} tom="sucesso" />
        <Indicador rotulo="A receber (fiado)" valor={formatarMoeda(aReceber)} tom={aReceber > 0 ? "alerta" : "neutro"} />
        <Indicador
          rotulo="Por forma"
          valor={validos.length}
          detalhe={[...porForma.entries()].map(([f, v]) => `${FORMAS_RECEBIMENTO[f] ?? f}: ${formatarMoeda(v)}`).join(" · ") || "nenhum"}
        />
      </div>
      {lista?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Paciente e descrição</Th>
                  <Th className="hidden sm:table-cell">Forma</Th>
                  <Th className="text-right">Valor</Th>
                  {ctx.gerente ? <Th className="text-right">Ações</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {lista.map((r) => {
                  const p = r.paciente as unknown as { id: string; nome: string } | null;
                  return (
                    <Tr key={r.id} className={r.cancelado_em ? "opacity-60" : undefined}>
                      <Td className="numero">{formatarData(r.data)}</Td>
                      <Td>
                        {p ? (
                          <Link href={`${base}/pacientes/${p.id}`} className="font-medium text-primary hover:underline">
                            {p.nome}
                          </Link>
                        ) : null}
                        <span className="block text-xs text-muted-foreground">
                          {r.descricao}
                          {r.vencimento ? ` · vence ${formatarData(r.vencimento)}` : ""}
                          {r.cancelado_em ? ` · estornado: ${r.cancelado_motivo}` : ""}
                        </span>
                      </Td>
                      <Td className="hidden sm:table-cell">{FORMAS_RECEBIMENTO[r.forma] ?? r.forma}</Td>
                      <Td className={`numero text-right ${r.cancelado_em ? "line-through" : ""}`}>{formatarMoeda(r.valor)}</Td>
                      {ctx.gerente ? (
                        <Td className="text-right">
                          {!r.cancelado_em ? (
                            <DialogoMotivo
                              acao={estornarRecebimento.bind(null, empresaId, r.id)}
                              titulo="Estornar este recebimento?"
                              descricao="O lançamento no Financeiro é cancelado. Se já foi conciliado, desfaça a conciliação antes."
                              rotuloBotao="Estornar"
                              textoConfirmar="Estornar"
                              icone={<RotateCcw />}
                            />
                          ) : null}
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={ReceiptText} titulo="Nenhum recebimento neste mês" />
      )}
    </>
  );
}
