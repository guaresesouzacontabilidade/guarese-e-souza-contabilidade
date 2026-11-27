import { Pause, Play, RefreshCw } from "lucide-react";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { Badge } from "@/components/ui/badge";
import { BotaoAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { alterarRecorrencia, gerarRecorrencias } from "@/lib/financeiro/acoes-lancamentos";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";

const FREQ: Record<string, string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

/** Recorrências da empresa (mensalidades, aluguéis, contratos): pausar, reativar e gerar agora. */
export async function TabelaRecorrencias({ ctx, empresaId }: { ctx: ContextoEmpresa; empresaId: string }) {
  const podeEditar = ctx.pode("financeiro.editar");
  const { data } = await ctx.supabase
    .from("recorrencias")
    .select("id, tipo, descricao, valor, frequencia, dia_vencimento, data_inicio, data_fim, ativa, ultima_data_gerada, categoria:categorias_financeiras(nome), contraparte:contrapartes(nome)")
    .eq("empresa_id", empresaId)
    .order("ativa", { ascending: false })
    .order("descricao");
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Mensalidades, aluguéis, assinaturas e contratos. Os títulos são gerados sozinhos alguns meses à frente. Para mudar só uma ocorrência ou
          esta e as próximas, abra o título em Contas a pagar ou a receber.
        </p>
        {podeEditar ? (
          <BotaoAcao variante="contorno" acao={gerarRecorrencias.bind(null, empresaId)}>
            <RefreshCw /> Gerar agora
          </BotaoAcao>
        ) : null}
      </div>
      {data?.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Descrição</Th>
              <Th>Frequência</Th>
              <Th className="text-right">Valor</Th>
              <Th>Período</Th>
              <Th>Situação</Th>
              <Th className="w-10">
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {data.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="block font-medium">{r.descricao}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.tipo === "receber" ? "A receber" : "A pagar"} · {(r.categoria as { nome: string } | null)?.nome}
                    {(r.contraparte as { nome: string } | null)?.nome ? ` · ${(r.contraparte as { nome: string }).nome}` : ""}
                  </span>
                </Td>
                <Td className="text-sm">
                  {FREQ[r.frequencia]}
                  {r.dia_vencimento ? ` · dia ${r.dia_vencimento}` : ""}
                </Td>
                <Td className="text-right numero">{formatarMoeda(r.valor)}</Td>
                <Td className="text-sm">
                  {formatarData(r.data_inicio)} {r.data_fim ? `a ${formatarData(r.data_fim)}` : "· sem fim"}
                  {r.ultima_data_gerada ? <span className="block text-xs text-muted-foreground">gerado até {formatarData(r.ultima_data_gerada)}</span> : null}
                </Td>
                <Td>{r.ativa ? <Badge variante="sucesso">Ativa</Badge> : <Badge variante="neutro">Pausada</Badge>}</Td>
                <Td>
                  {podeEditar ? (
                    <BotaoAcao tamanho="iconeSm" variante="fantasma" aria-label={r.ativa ? "Pausar" : "Reativar"} acao={alterarRecorrencia.bind(null, empresaId, r.id, !r.ativa)}>
                      {r.ativa ? <Pause /> : <Play />}
                    </BotaoAcao>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={RefreshCw} titulo="Nenhuma recorrência" descricao="Ao criar um lançamento, escolha “Recorrente” para gerar as próximas ocorrências automaticamente." />
      )}
    </>
  );
}
