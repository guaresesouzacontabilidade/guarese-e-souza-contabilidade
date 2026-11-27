import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { PontoDeVenda } from "@/components/loja/ponto-de-venda";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarPdv } from "@/lib/gestao/pdv-dados";
import type { NotaNaVenda } from "@/lib/gestao/rotulos";

export const metadata: Metadata = { title: "Orçamento" };

const SEM_NOTA: NotaNaVenda = {
  configurada: false,
  nfe: { disponivel: false, motivo: null, ambiente: null },
  nfce: { disponivel: false, motivo: null, ambiente: null },
  obrigatoriaFormas: [],
  documentoPadrao: "nfe",
  marcadaPadrao: false,
  documentosComEndereco: [],
};

/** Orçamento sem abrir o caixa (balcão, tablet): salva, imprime e manda pelo WhatsApp. */
export default async function PaginaOrcamento({ params, searchParams }: PageProps<"/e/[empresaId]/loja/orcamento">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const dados = await carregarPdv(ctx.supabase, empresaId, sp.editar);
  const { orcamento } = dados;

  return (
    <>
      <CabecalhoPagina
        titulo={orcamento ? `Editar o orçamento nº ${orcamento.numero}` : "Novo orçamento"}
        descricao="Não precisa abrir o caixa. Depois de salvar, é só imprimir ou mandar pelo WhatsApp do cliente."
        acoes={
          <Button asChild variante="contorno">
            <Link href={`/e/${empresaId}/loja/vendas?tipo=orcamento`}>
              <ListChecks /> Orçamentos feitos
            </Link>
          </Button>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      {dados.orcamentoFechado ? (
        <Alerta tom="alerta" className="mb-4">
          Este orçamento não está mais em aberto (já virou venda ou foi cancelado). Você pode fazer um novo abaixo.
        </Alerta>
      ) : null}
      {!dados.produtos.length ? (
        <Alerta tom="info" className="mb-4" titulo="Nenhum produto cadastrado">
          {ctx.gerente ? (
            <>
              Cadastre os produtos em <Link href={`/e/${empresaId}/loja/produtos`} className="underline">Produtos e estoque</Link> para fazer orçamentos.
            </>
          ) : (
            "Peça ao gerente da loja para cadastrar os produtos."
          )}
        </Alerta>
      ) : null}
      <PontoDeVenda
        key={orcamento?.id ?? "novo-orcamento"}
        modo="orcamento"
        empresaId={empresaId}
        sessaoId={null}
        caixaNome=""
        produtos={dados.produtos}
        clientes={dados.clientes}
        permitirPrazo={false}
        orcamento={orcamento}
        nota={SEM_NOTA}
        etiqueta={dados.etiqueta}
        vendedores={dados.vendedores}
        vendedorObrigatorio={dados.vendedorObrigatorio}
      />
    </>
  );
}
