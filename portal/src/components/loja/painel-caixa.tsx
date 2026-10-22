import Link from "next/link";
import { Banknote, CreditCard, FileDown, QrCode, ShoppingCart, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Indicador } from "@/components/ui/pagina";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EstadoVazio } from "@/components/ui/feedback";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { FORMAS_PAGAMENTO, formatarQuantidade, hora, un } from "@/lib/gestao/rotulos";
import { totalCartao, valorDaForma, type RelatorioCaixa } from "@/lib/gestao/dados";
import { FecharCaixa, MovimentoCaixa, type ContaOpcao } from "./formularios-caixa";

/** Caixa (aberto ou fechado): resumo, gaveta, vendas uma a uma, sangrias e produtos. */
export function PainelCaixa({
  empresaId,
  relatorio,
  podeOperar,
  contas,
}: {
  empresaId: string;
  relatorio: RelatorioCaixa;
  podeOperar: boolean;
  contas: ContaOpcao[];
}) {
  const { sessao: s, resumo: r, vendas, movimentos, produtos } = relatorio;
  const aberto = s.status === "aberto";
  const pdf = `/api/loja/caixa/${s.id}/relatorio`;
  const diferenca = s.diferenca != null ? dec(s.diferenca) : null;
  const esperado = Number(r.dinheiro_esperado ?? 0);
  const media = r.vendas_quantidade ? dec(r.vendas_total).div(r.vendas_quantidade) : dec(0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variante={aberto ? "sucesso" : "neutro"}>{aberto ? "Aberto" : "Fechado"}</Badge>
          <span>
            {s.caixa_nome} · {formatarData(s.data)} · {s.operador ?? "—"} · aberto às {hora(s.aberto_em)}
            {s.fechado_em ? ` · fechado às ${hora(s.fechado_em)}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {aberto && podeOperar ? (
            <>
              <Button asChild variante="secundario">
                <Link href={`/e/${empresaId}/loja/vender`}>
                  <ShoppingCart /> Vender
                </Link>
              </Button>
              <MovimentoCaixa empresaId={empresaId} sessaoId={s.id} tipo="sangria" contas={contas} esperado={esperado} />
              <MovimentoCaixa empresaId={empresaId} sessaoId={s.id} tipo="suprimento" contas={contas} esperado={esperado} />
            </>
          ) : null}
          <Button asChild variante="contorno">
            <a href={`${pdf}?ver=1`} target="_blank" rel="noopener">
              <FileDown /> {aberto ? "Relatório até agora (PDF)" : "Relatório do dia (PDF)"}
            </a>
          </Button>
          {aberto && podeOperar ? <FecharCaixa empresaId={empresaId} sessaoId={s.id} esperado={esperado} /> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Indicador rotulo="Total vendido" valor={formatarMoeda(r.vendas_total)} detalhe={`${r.vendas_quantidade} venda(s) · média de ${formatarMoeda(media)} por venda`} icone={ShoppingCart} />
        <Indicador rotulo="Dinheiro" valor={formatarMoeda(valorDaForma(r, "dinheiro"))} detalhe={`${r.por_forma?.dinheiro?.vendas ?? 0} venda(s)`} icone={Banknote} tom="sucesso" />
        <Indicador rotulo="PIX" valor={formatarMoeda(valorDaForma(r, "pix"))} detalhe={`${r.por_forma?.pix?.vendas ?? 0} venda(s)`} icone={QrCode} tom="info" />
        <Indicador
          rotulo="Cartão"
          valor={formatarMoeda(totalCartao(r))}
          detalhe={`débito ${formatarMoeda(valorDaForma(r, "cartao_debito"))} · crédito ${formatarMoeda(valorDaForma(r, "cartao_credito"))}`}
          icone={CreditCard}
        />
        <Indicador rotulo="A prazo" valor={formatarMoeda(valorDaForma(r, "a_prazo"))} detalhe="vai para contas a receber" icone={Wallet} tom="alerta" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Vendas, uma por uma</CardTitle>
          </CardHeader>
          <CardContent>
            {vendas.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Hora</Th>
                    <Th>Cliente e itens</Th>
                    <Th>Pagamento</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </THead>
                <TBody>
                  {vendas.map((v) => (
                    <Tr key={v.id} className={v.status === "cancelada" ? "opacity-60" : undefined}>
                      <Td className="align-top font-semibold">
                        <Link href={`/e/${empresaId}/loja/vendas/${v.id}`} className="hover:underline">
                          {v.numero}
                        </Link>
                      </Td>
                      <Td className="align-top text-muted-foreground numero">{hora(v.hora)}</Td>
                      <Td className="align-top">
                        <p className="font-medium">{v.cliente ?? "Consumidor"}</p>
                        <ul className="text-xs text-muted-foreground">
                          {v.itens.map((i, n) => (
                            <li key={n} className={v.status === "cancelada" ? "line-through" : undefined}>
                              {i.pecas ? `${formatarQuantidade(i.pecas, 3)} pç = ` : ""}
                              {formatarQuantidade(i.quantidade)} {un(i.unidade)} {i.descricao}
                            </li>
                          ))}
                        </ul>
                        {v.status === "cancelada" ? <Badge variante="perigo">Cancelada</Badge> : null}
                      </Td>
                      <Td className="align-top text-xs">
                        {v.pagamentos.map((p, n) => (
                          <p key={n}>
                            {FORMAS_PAGAMENTO[p.forma]} {formatarMoeda(p.valor)}
                            {p.parcelas > 1 ? ` em ${p.parcelas}x` : ""}
                          </p>
                        ))}
                        {dec(v.troco).gt(0) ? <p className="text-muted-foreground">troco {formatarMoeda(v.troco)}</p> : null}
                      </Td>
                      <Td className="whitespace-nowrap align-top text-right font-semibold numero">{formatarMoeda(v.total)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={ShoppingCart} titulo="Nenhuma venda ainda" descricao={aberto ? "As vendas deste caixa aparecem aqui assim que forem concluídas." : undefined} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dinheiro da gaveta</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <Linha rotulo="Troco inicial" valor={formatarMoeda(r.abertura)} />
                <Linha rotulo="+ Vendas em dinheiro" valor={formatarMoeda(valorDaForma(r, "dinheiro"))} />
                <Linha rotulo={`+ Suprimentos (${r.qtd_suprimentos})`} valor={formatarMoeda(r.suprimentos)} />
                <Linha rotulo={`− Sangrias (${r.qtd_sangrias})`} valor={formatarMoeda(r.sangrias)} />
                <div className="border-t border-border pt-1.5">
                  <Linha rotulo="Deve ter na gaveta" valor={formatarMoeda(r.dinheiro_esperado)} forte />
                </div>
                {!aberto ? (
                  <>
                    <Linha rotulo="Contado no fechamento" valor={formatarMoeda(s.valor_contado)} />
                    <Linha
                      rotulo={diferenca && !diferenca.isZero() ? (diferenca.gt(0) ? "Sobra" : "Falta") : "Diferença"}
                      valor={diferenca && !diferenca.isZero() ? formatarMoeda(diferenca.abs()) : "Conferiu"}
                      forte
                      tom={diferenca && !diferenca.isZero() ? (diferenca.gt(0) ? "text-alerta" : "text-perigo") : "text-sucesso"}
                    />
                    {s.observacao_fechamento ? <p className="pt-1 text-xs text-muted-foreground">Obs.: {s.observacao_fechamento}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      Fechado em {formatarDataHora(s.fechado_em)}
                      {s.fechado_por ? ` por ${s.fechado_por}` : ""}.
                    </p>
                  </>
                ) : null}
              </dl>
              {r.canceladas_quantidade ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {r.canceladas_quantidade} venda(s) cancelada(s) somando {formatarMoeda(r.canceladas_total)} (fora do total).
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sangrias e suprimentos</CardTitle>
            </CardHeader>
            <CardContent>
              {movimentos.length ? (
                <ul className="space-y-2 text-sm">
                  {movimentos.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {m.tipo === "sangria" ? "Sangria" : "Suprimento"} <span className="font-normal text-muted-foreground">· {hora(m.hora)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.motivo}
                          {m.conta ? ` → ${m.conta}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap font-semibold numero ${m.tipo === "sangria" ? "text-perigo" : "text-sucesso"}`}>
                        {m.tipo === "sangria" ? "−" : "+"} {formatarMoeda(m.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma sangria ou suprimento.</p>
              )}
            </CardContent>
          </Card>

          {produtos.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Produtos vendidos</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {produtos.map((p) => (
                    <li key={`${p.descricao}|${un(p.unidade)}`} className="flex justify-between gap-2">
                      <span className="min-w-0">
                        {p.descricao}
                        <span className="block text-xs text-muted-foreground">
                          {formatarQuantidade(p.quantidade)} {un(p.unidade)}
                          {p.pecas ? ` · ${formatarQuantidade(p.pecas, 3)} peça(s)` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap font-medium numero">{formatarMoeda(p.total)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, forte, tom }: { rotulo: string; valor: string; forte?: boolean; tom?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={forte ? "font-semibold" : "text-muted-foreground"}>{rotulo}</dt>
      <dd className={`numero ${forte ? "font-semibold" : ""} ${tom ?? ""}`}>{valor}</dd>
    </div>
  );
}
