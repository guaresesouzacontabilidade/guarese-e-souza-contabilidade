import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { FormConfigLoja } from "@/components/loja/configuracao-loja";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Configurações da loja" };

export default async function PaginaConfigLoja({ params }: PageProps<"/e/[empresaId]/loja/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.equipe && !ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={false} ativa={ctx.lojaAtiva} />;
  const [{ data: cfg }, { data: contas }] = await Promise.all([
    ctx.supabase.from("gestao_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).neq("tipo", "cartao_credito").order("nome"),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo="Configurações da loja"
        descricao="Caixa, vendas, estoque e notas ligados à contabilidade. Serviço opcional, contratado com o escritório."
      />
      {ctx.lojaAtiva ? <NavegacaoLoja empresaId={empresaId} configurar /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormConfigLoja
              empresaId={empresaId}
              equipe={ctx.equipe}
              contas={contas ?? []}
              config={
                cfg
                  ? {
                      ativa: cfg.ativa,
                      perfil_fiscal: cfg.perfil_fiscal,
                      permitir_estoque_negativo: cfg.permitir_estoque_negativo,
                      permitir_venda_prazo: cfg.permitir_venda_prazo,
                      desconto_maximo_operador: cfg.desconto_maximo_operador == null ? null : String(cfg.desconto_maximo_operador),
                      validade_orcamento_dias: cfg.validade_orcamento_dias,
                      mensagem_comprovante: cfg.mensagem_comprovante,
                      conta_dinheiro_id: cfg.conta_dinheiro_id,
                      conta_pix_id: cfg.conta_pix_id,
                      conta_cartao_id: cfg.conta_cartao_id,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
        <div className="space-y-3">
          <Alerta tom="info" titulo="Quem pode usar">
            O responsável pela empresa já tem acesso. Para um funcionário do balcão, convide-o em{" "}
            <Link href={`/e/${empresaId}/configuracoes`} className="underline">
              Configurações
            </Link>{" "}
            com a permissão “Vender no caixa”. Quem tem “Gerenciar a loja” cadastra produtos, dá descontos sem limite, cancela vendas e mexe no estoque.
          </Alerta>
          <Alerta tom="sucesso" titulo="Tudo vai para a contabilidade">
            Cada venda entra no Financeiro (recebida ou a receber), baixa o estoque e fica disponível para o escritório no fechamento do mês.
          </Alerta>
          <Alerta tom="alerta" titulo="Notas fiscais">
            A NF-e é emitida a partir da venda quando o cliente pedir. A NFC-e (cupom fiscal) precisa do credenciamento na SEFAZ-TO e do código CSC — o
            escritório ajuda a fazer, e ela fica desligada até lá.
          </Alerta>
        </div>
      </div>
    </>
  );
}
