import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Esteira, type OsCartao } from "@/components/os/esteira";
import type { PessoaOs, ServicoOs } from "@/components/os/form-os";
import { mensagemErro } from "@/lib/acoes";
import { envPublico } from "@/lib/env";

export const metadata: Metadata = { title: "Ordens de serviço" };

export default async function EsteiraOs({ params }: PageProps<"/e/[empresaId]/os">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("os.operar")) return <Alerta tom="alerta">Seu acesso não inclui as ordens de serviço desta empresa.</Alerta>;
  const gerenciar = ctx.pode("os.gerenciar");
  const seteDias = new Date(new Date().getTime() - 7 * 86400_000).toISOString();

  const [{ data: ativas, error }, { data: entregues }, { data: equipe }, { data: servicos }, { data: cfg }] = await Promise.all([
    ctx.supabase
      .from("os_ordens")
      .select("*, itens:os_itens(descricao, quantidade, unidade, posicao)")
      .eq("empresa_id", empresaId)
      .in("etapa", ["fila", "execucao", "pronta"])
      .order("ordem")
      .limit(500),
    ctx.supabase
      .from("os_ordens")
      .select("*, itens:os_itens(descricao, quantidade, unidade, posicao)")
      .eq("empresa_id", empresaId)
      .eq("etapa", "entregue")
      .gte("entregue_em", seteDias)
      .order("entregue_em", { ascending: false })
      .limit(100),
    ctx.supabase.from("os_equipe").select("id, nome, cor, ativo").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("os_servicos").select("*").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("os_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar as ordens de serviço: {mensagemErro(error)}</Alerta>;

  const ordens = [...(ativas ?? []), ...(entregues ?? [])].map((o) => ({
    ...o,
    itens: [...((o.itens as unknown as { descricao: string; quantidade: number; unidade: string; posicao: number }[]) ?? [])].sort((a, b) => a.posicao - b.posicao),
  })) as unknown as OsCartao[];
  const listaServicos = (servicos ?? []) as ServicoOs[];
  const nomeLoja = cfg?.nome_exibicao ?? ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social;

  return (
    <>
      <CabecalhoPagina
        titulo="Ordens de serviço"
        descricao="Arraste a OS de uma coluna para a outra (ou use os botões do cartão). O relógio mostra o tempo de cada etapa e a barra compara a execução com o tempo estimado."
      />
      {!listaServicos.some((s) => s.ativo) ? (
        <Alerta tom="info" className="mb-4" titulo="Comece pelos serviços">
          {gerenciar ? (
            <>
              Cadastre os serviços que a loja faz, com o tempo estimado de cada um (ex.: corte de MDF, 4 min por chapa), em{" "}
              <Link href={`/e/${empresaId}/os/configuracoes`} className="font-medium underline">
                Serviços e equipe
              </Link>
              . Depois é só abrir as OS.
            </>
          ) : (
            "Peça ao responsável da loja para cadastrar os serviços com o tempo estimado. Depois é só abrir as OS."
          )}
        </Alerta>
      ) : null}
      <Esteira
        empresaId={empresaId}
        ordens={ordens}
        equipe={(equipe ?? []) as PessoaOs[]}
        servicos={listaServicos}
        mensagemPronta={cfg?.mensagem_pronta ?? null}
        loja={nomeLoja}
        siteUrl={envPublico.siteUrl()}
        podeGerenciar={gerenciar}
        executores={cfg?.executores_simultaneos ?? 1}
      />
    </>
  );
}
