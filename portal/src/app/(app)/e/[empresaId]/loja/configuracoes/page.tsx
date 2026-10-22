import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoCarregamentos, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { FormConfigLoja } from "@/components/loja/configuracao-loja";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Configurações da loja" };

export default async function PaginaConfigLoja({ params }: PageProps<"/e/[empresaId]/loja/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.equipe && !ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={false} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const [{ data: cfg }, { data: contas }, { data: nfeCfg }, { data: operacoes }, { data: emitentes }] = await Promise.all([
    ctx.supabase.from("gestao_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).neq("tipo", "cartao_credito").order("nome"),
    ctx.supabase.from("nfe_config").select("ativa").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("nfe_operacoes").select("id, nome, cfop").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.supabase.from("nfe_emitentes").select("id, nome, inscricao_estadual, serie").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo={ctx.notas ? "Configurações da gestão" : "Configurações da loja"}
        descricao={
          ctx.notas
            ? "Ordens de carregamento e NF-e ligadas à contabilidade. Serviço opcional, contratado com o escritório."
            : "Caixa, vendas, estoque e notas ligados à contabilidade. Serviço opcional, contratado com o escritório."
        }
      />
      {ctx.lojaAtiva ? ctx.notas ? <NavegacaoCarregamentos empresaId={empresaId} configurar /> : <NavegacaoLoja empresaId={empresaId} configurar /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormConfigLoja
              empresaId={empresaId}
              equipe={ctx.equipe}
              contas={contas ?? []}
              nfe={
                nfeCfg && (operacoes?.length || emitentes?.length)
                  ? {
                      ativa: nfeCfg.ativa,
                      operacoes: (operacoes ?? []).map((o) => ({ id: o.id, nome: o.nome, cfop: o.cfop })),
                      emitentes: (emitentes ?? []).map((e) => ({ id: e.id, nome: e.nome, inscricao: e.inscricao_estadual, serie: e.serie })),
                    }
                  : null
              }
              config={
                cfg
                  ? {
                      ativa: cfg.ativa,
                      modalidade: cfg.modalidade === "notas" ? "notas" : "loja",
                      perfil_fiscal: cfg.perfil_fiscal,
                      permitir_estoque_negativo: cfg.permitir_estoque_negativo,
                      permitir_venda_prazo: cfg.permitir_venda_prazo,
                      desconto_maximo_operador: cfg.desconto_maximo_operador == null ? null : String(cfg.desconto_maximo_operador),
                      validade_orcamento_dias: cfg.validade_orcamento_dias,
                      mensagem_comprovante: cfg.mensagem_comprovante,
                      conta_dinheiro_id: cfg.conta_dinheiro_id,
                      conta_pix_id: cfg.conta_pix_id,
                      conta_cartao_id: cfg.conta_cartao_id,
                      nfe_operacao_id: cfg.nfe_operacao_id,
                      nfe_emitente_id: cfg.nfe_emitente_id,
                      nfe_marcada_padrao: cfg.nfe_marcada_padrao,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
        {ctx.notas ? (
          <div className="space-y-3">
            <Alerta tom="info" titulo="Quem pode usar">
              Quem tem a permissão “Emitir nota de produto” faz as ordens de carregamento, registra a pesagem e emite a NF-e. Convide as pessoas em{" "}
              <Link href={`/e/${empresaId}/configuracoes`} className="underline">
                Configurações
              </Link>
              .
            </Alerta>
            <Alerta tom="alerta" titulo="Documentos do transporte">
              A ordem de carregamento é um controle interno. Quando a empresa transporta a carga em veículo próprio, a SEFAZ-MT exige o MDF-e; quando presta frete
              para terceiros, o CT-e. Esses documentos ainda não são emitidos pelo portal.
            </Alerta>
          </div>
        ) : (
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
        )}
      </div>
    </>
  );
}
