import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListTree } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { EditorModeloDre, type ContaLinha, type LinhaEditor } from "@/components/relatorios/editor-modelo-dre";
import { carregarModeloDre } from "@/lib/relatorios/dados";
import { linhaDaConta, modeloPadrao, ordenarLinhas } from "@/lib/relatorios/modelo-dre";
import { personalizarDre } from "@/lib/relatorios/acoes-modelo-dre";
import { tipoEntraNoDre } from "@/lib/financeiro/plano-contas";

export const metadata: Metadata = { title: "Modelo do DRE" };

export default async function PersonalizarDre({ params }: PageProps<"/e/[empresaId]/relatorios/dre/personalizar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}/relatorios/publicados`);
  const podeEditar = ctx.pode("financeiro.editar");
  const voltar = { href: `/e/${empresaId}/relatorios/dre`, rotulo: "Resultado (DRE)" };

  const [modeloEmpresa, { data: cats }] = await Promise.all([
    carregarModeloDre(ctx.supabase, empresaId),
    ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, tipo, pai_id, sintetica, dre_linha_id, ativa").eq("empresa_id", empresaId).order("codigo"),
  ]);
  const categorias = cats ?? [];
  const modelo = modeloEmpresa ?? { linhas: modeloPadrao(), categorias };
  const linhas = ordenarLinhas(modelo.linhas);

  // Contas de cada linha (contas do DRE; grupos aparecem quando foram levados inteiros)
  const contasPorLinha: Record<string, ContaLinha[]> = {};
  for (const c of categorias) {
    if (c.sintetica) {
      if (c.dre_linha_id) (contasPorLinha[c.dre_linha_id] ??= []).push({ id: c.id, rotulo: `${c.codigo} ${c.nome} (grupo inteiro)`, explicita: true, ativa: c.ativa });
      continue;
    }
    if (!tipoEntraNoDre(c.tipo)) continue;
    const linha = linhaDaConta(modelo, c.id, c.tipo);
    if (!linha) continue;
    const pai = c.pai_id ? categorias.find((g) => g.id === c.pai_id) : null;
    (contasPorLinha[linha.id] ??= []).push({
      id: c.id,
      rotulo: `${c.codigo} ${c.nome}`,
      explicita: Boolean(c.dre_linha_id),
      viaGrupo: !c.dre_linha_id && pai?.dre_linha_id === linha.id ? pai.nome : undefined,
      ativa: c.ativa,
    });
  }
  const opcoesConta = categorias
    .filter((c) => c.sintetica || tipoEntraNoDre(c.tipo))
    .map((c) => ({ id: c.id, rotulo: `${c.codigo} ${c.nome}${c.sintetica ? " (grupo inteiro)" : ""}`, linhaId: c.dre_linha_id }));

  const linhasEditor: LinhaEditor[] = linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    rotulo: l.rotulo,
    padrao: Boolean(l.chave_padrao),
    resultado: l.chave_padrao === "resultado_liquido",
    mostrar_contas: l.mostrar_contas,
    oculta: l.oculta,
  }));

  return (
    <>
      <CabecalhoPagina
        voltar={voltar}
        titulo="Modelo do DRE"
        descricao="Escolha como o resultado é apresentado: nomes das linhas, ordem, linhas e subtotais próprios. Os valores continuam vindo dos lançamentos; nada some."
      />
      {!modeloEmpresa ? (
        <div className="space-y-4">
          <Alerta tom="info" titulo="O DRE está no modelo padrão">
            Ao personalizar, o portal copia as linhas abaixo para a empresa. Depois você renomeia, muda a ordem, cria linhas (ex.: “Despesas com pessoal”) e
            subtotais (ex.: “Margem de contribuição”). Dá para voltar ao padrão a qualquer momento.
          </Alerta>
          {podeEditar ? (
            <BotaoAcao acao={personalizarDre.bind(null, empresaId)}>
              <ListTree /> Personalizar o DRE
            </BotaoAcao>
          ) : (
            <p className="text-sm text-muted-foreground">Seu acesso permite apenas consultar o DRE.</p>
          )}
          <EditorModeloDre empresaId={empresaId} linhas={linhasEditor} contasPorLinha={contasPorLinha} opcoesConta={opcoesConta} podeEditar={false} />
        </div>
      ) : (
        <EditorModeloDre empresaId={empresaId} linhas={linhasEditor} contasPorLinha={contasPorLinha} opcoesConta={opcoesConta} podeEditar={podeEditar} />
      )}
    </>
  );
}
