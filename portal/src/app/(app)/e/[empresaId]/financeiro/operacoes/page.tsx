import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Operacoes } from "@/components/financeiro/operacoes";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { excluirTransferencia } from "@/lib/financeiro/acoes-lancamentos";
import { hojeISO } from "@/lib/competencia";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";

export const metadata: Metadata = { title: "Operações financeiras" };

const TIPOS_TRANSF: Record<string, string> = {
  transferencia: "Transferência",
  pagamento_fatura_cartao: "Pagamento de fatura",
  aplicacao: "Aplicação",
  resgate: "Resgate",
  repasse_adquirente: "Repasse da maquininha",
};

export default async function PaginaOperacoes({ params }: PageProps<"/e/[empresaId]/financeiro/operacoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const podeEditar = ctx.pode("financeiro.editar");
  const [opcoes, { data: transferencias }] = await Promise.all([
    carregarOpcoes(ctx, empresaId),
    ctx.supabase
      .from("transferencias")
      .select("id, data, valor, tipo, descricao, conciliacao_id, origem:contas_financeiras!transferencias_empresa_id_conta_origem_id_fkey(nome), destino:contas_financeiras!transferencias_empresa_id_conta_destino_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .order("data", { ascending: false })
      .limit(30),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo="Operações financeiras"
        descricao="Registros com regras próprias para não distorcer o resultado: transferências, cartão de crédito, maquininhas, empréstimos e estoque."
      />
      {podeEditar ? <Operacoes empresaId={empresaId} opcoes={opcoes} hoje={hojeISO()} /> : <Alerta tom="info">Seu acesso permite apenas consultar.</Alerta>}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Transferências recentes</CardTitle>
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
    </>
  );
}
