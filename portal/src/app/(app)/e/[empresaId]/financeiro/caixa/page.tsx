import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Banknote, CreditCard, FileUp, GitCompareArrows, Trash2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ListaContas, type ContaFinanceira } from "@/components/financeiro/contas";
import { Operacoes } from "@/components/financeiro/operacoes";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { excluirTransferencia } from "@/lib/financeiro/acoes-lancamentos";
import { hojeISO } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { TIPOS_CONTA } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Caixa e bancos" };

const TIPOS_TRANSF: Record<string, string> = {
  transferencia: "Transferência",
  pagamento_fatura_cartao: "Pagamento de fatura",
  aplicacao: "Aplicação",
  resgate: "Resgate",
  repasse_adquirente: "Repasse da maquininha",
};

type Saldo = {
  conta_id: string;
  nome: string;
  tipo: string;
  saldo_sistema: number | null;
  saldo_extrato: number | null;
  saldo_extrato_data: string | null;
  ultimo_movimento_data: string | null;
  movimentos_pendentes: number;
  conciliado_ate: string | null;
};

/**
 * Caixa e bancos: onde está o dinheiro (bancos, caixa, cartões e
 * maquininhas), transferências entre contas (não são receita nem despesa) e
 * as operações com regras próprias (fatura de cartão, maquininha, empréstimo).
 */
export default async function CaixaEBancos({ params }: PageProps<"/e/[empresaId]/financeiro/caixa">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const hoje = hojeISO();
  const podeEditar = ctx.pode("financeiro.editar");
  const base = `/e/${empresaId}/financeiro`;
  const [{ data: contas }, { data: saldos }, { data: estoques }, opcoes, { data: transferencias }] = await Promise.all([
    ctx.supabase.from("contas_financeiras").select("*").eq("empresa_id", empresaId).order("ativa", { ascending: false }).order("nome"),
    ctx.supabase.rpc("saldos_contas", { p_empresa_id: empresaId, p_data: hoje }),
    ctx.supabase.from("estoques").select("id, competencia, valor_estoque_final, fonte").eq("empresa_id", empresaId).order("competencia", { ascending: false }).limit(12),
    carregarOpcoes(ctx, empresaId),
    ctx.supabase
      .from("transferencias")
      .select("id, data, valor, tipo, descricao, conciliacao_id, origem:contas_financeiras!transferencias_empresa_id_conta_origem_id_fkey(nome), destino:contas_financeiras!transferencias_empresa_id_conta_destino_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .order("data", { ascending: false })
      .limit(30),
  ]);
  const lista = (saldos ?? []) as Saldo[];
  const disponiveis = new Set((contas ?? []).filter((c) => c.ativa && c.compoe_saldo_disponivel).map((c) => c.id as string));
  const totalDisponivel = somar(lista.filter((s) => disponiveis.has(s.conta_id)).map((s) => s.saldo_sistema ?? 0));

  return (
    <>
      <CabecalhoPagina
        titulo="Caixa e bancos"
        descricao="Onde está o dinheiro, por conta, e as transferências entre contas — que movimentam os saldos sem virar receita nem despesa."
        acoes={
          <>
            {podeEditar ? (
              <Button asChild variante="contorno">
                <a href="#operacoes">
                  <ArrowLeftRight /> Transferência
                </a>
              </Button>
            ) : null}
            {ctx.pode("financeiro.importar") ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/importar`}>
                  <FileUp /> Importar extrato
                </Link>
              </Button>
            ) : null}
            <Button asChild variante="contorno">
              <Link href={`/e/${empresaId}/conciliacao`}>
                <GitCompareArrows /> Conciliação
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Saldos em {formatarData(hoje)}</CardTitle>
          <CardDescription>
            Disponível agora (bancos e caixa): <strong className="numero text-foreground">{formatarMoeda(totalDisponivel)}</strong>. Saldo calculado pelo portal (saldo
            inicial + pagamentos, recebimentos e transferências) ao lado do último saldo informado pelo banco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <Th>Conta</Th>
                <Th className="text-right">Saldo no portal</Th>
                <Th className="text-right">Último saldo do extrato</Th>
                <Th>Extrato até</Th>
                <Th>Conciliado até</Th>
                <Th className="text-right">A conciliar</Th>
              </tr>
            </THead>
            <TBody>
              {lista.map((s) => (
                <Tr key={s.conta_id}>
                  <Td>
                    <span className="block font-medium">{s.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {TIPOS_CONTA[s.tipo]}
                      {disponiveis.has(s.conta_id) ? "" : " · fora do saldo disponível"}
                    </span>
                  </Td>
                  <Td className={`text-right numero ${(s.saldo_sistema ?? 0) < 0 ? "text-perigo" : ""}`}>{s.saldo_sistema != null ? formatarMoeda(s.saldo_sistema) : "—"}</Td>
                  <Td className="text-right numero">
                    {s.saldo_extrato != null ? formatarMoeda(s.saldo_extrato) : "—"}
                    {s.saldo_extrato_data ? <span className="block text-xs text-muted-foreground">em {formatarData(s.saldo_extrato_data)}</span> : null}
                  </Td>
                  <Td className="text-sm">{formatarData(s.ultimo_movimento_data)}</Td>
                  <Td className="text-sm">{formatarData(s.conciliado_ate)}</Td>
                  <Td className="text-right numero">
                    {s.movimentos_pendentes ? (
                      <Link className="text-primary underline-offset-2 hover:underline" href={`/e/${empresaId}/conciliacao`}>
                        {s.movimentos_pendentes}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {ctx.pode("maquininhas.ver") ? (
          <Link href={`/e/${empresaId}/maquininhas`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40">
            <CreditCard className="mt-0.5 size-5 text-primary" />
            <span>
              <span className="block font-medium">Maquininhas e cartões</span>
              <span className="text-sm text-muted-foreground">Vendas, taxas cobradas e conferência com o contrato.</span>
            </span>
          </Link>
        ) : null}
        {ctx.acesso.loja && ctx.pode("gestao.vender") ? (
          <Link href={`/e/${empresaId}/loja/caixa`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40">
            <Banknote className="mt-0.5 size-5 text-primary" />
            <span>
              <span className="block font-medium">Caixa do dia (loja)</span>
              <span className="text-sm text-muted-foreground">Abertura, sangria, suprimento e fechamento do caixa.</span>
            </span>
          </Link>
        ) : null}
      </div>

      <ListaContas empresaId={empresaId} contas={(contas ?? []) as ContaFinanceira[]} podeEditar={podeEditar} />

      <section id="operacoes" className="mt-6 scroll-mt-24">
        <h2 className="mb-3 text-lg font-semibold">Transferências e operações</h2>
        {podeEditar ? <Operacoes empresaId={empresaId} opcoes={opcoes} hoje={hoje} /> : <Alerta tom="info">Seu acesso permite apenas consultar.</Alerta>}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Transferências recentes</CardTitle>
          <CardDescription>Saída de uma conta e entrada na outra, ligadas. Não entram nos totais de receitas e despesas.</CardDescription>
        </CardHeader>
        <CardContent>
          {transferencias?.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th>De → para</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="w-10">
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {transferencias.map((t) => (
                  <Tr key={t.id}>
                    <Td className="whitespace-nowrap text-sm">{formatarData(t.data)}</Td>
                    <Td className="text-sm">
                      {TIPOS_TRANSF[t.tipo] ?? t.tipo}
                      {t.descricao ? <span className="block text-xs text-muted-foreground">{t.descricao}</span> : null}
                    </Td>
                    <Td className="text-sm">
                      {(t.origem as { nome: string } | null)?.nome} → {(t.destino as { nome: string } | null)?.nome}
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(t.valor)}</Td>
                    <Td>
                      {podeEditar && !t.conciliacao_id ? (
                        <BotaoAcao
                          tamanho="iconeSm"
                          variante="fantasma"
                          aria-label="Excluir transferência"
                          acao={excluirTransferencia.bind(null, empresaId, t.id)}
                          confirmar={{ titulo: "Excluir esta transferência?", descricao: "Os saldos das duas contas serão recalculados.", textoConfirmar: "Excluir", perigo: true }}
                        >
                          <Trash2 />
                        </BotaoAcao>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma transferência registrada.</p>
          )}
        </CardContent>
      </Card>

      {estoques?.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Estoque final informado</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {estoques.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {formatarCompetencia(e.competencia, true)}
                    {e.fonte ? <span className="block text-xs text-muted-foreground">{e.fonte}</span> : null}
                  </span>
                  <span className="numero">{formatarMoeda(e.valor_estoque_final)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
