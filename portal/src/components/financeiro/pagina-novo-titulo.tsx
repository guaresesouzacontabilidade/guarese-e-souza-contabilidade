import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioLancamento, type ValoresLancamento } from "@/components/financeiro/formulario-lancamento";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { hojeISO } from "@/lib/competencia";
import { parametro } from "@/lib/busca";

const UUID = /^[0-9a-f-]{36}$/i;

type Sp = Record<string, string | string[] | undefined>;

/** Nova despesa (Contas a pagar) ou nova receita (Contas a receber): única, parcelada ou recorrente. */
export async function PaginaNovoTitulo({ ctx, empresaId, sp, tipo }: { ctx: ContextoEmpresa; empresaId: string; sp: Sp; tipo: "pagar" | "receber" }) {
  if (!ctx.pode("financeiro.editar")) return <Alerta tom="alerta">Seu acesso permite apenas consultar o financeiro.</Alerta>;
  const base = `/e/${empresaId}/financeiro/${tipo}`;
  const hoje = hojeISO();
  const valores: ValoresLancamento = {
    tipo,
    descricao: "",
    categoria_id: "",
    contraparte_id: "",
    centro_custo_id: "",
    projeto_id: "",
    conta_financeira_id: "",
    data_competencia: hoje,
    data_vencimento: hoje,
    valor: "",
    numero_documento: "",
    observacoes: "",
  };

  // "Lançar de novo": copia um lançamento (conta, fornecedor, valor, descrição) com a data de hoje
  const copiarId = UUID.test(parametro(sp, "copiar")) ? parametro(sp, "copiar") : null;
  if (copiarId) {
    const { data: l } = await ctx.supabase
      .from("lancamentos")
      .select("tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id, valor_previsto")
      .eq("id", copiarId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (l) {
      Object.assign(valores, {
        tipo: l.tipo,
        descricao: l.descricao,
        categoria_id: l.categoria_id ?? "",
        contraparte_id: l.contraparte_id ?? "",
        centro_custo_id: l.centro_custo_id ?? "",
        projeto_id: l.projeto_id ?? "",
        conta_financeira_id: l.conta_financeira_id ?? "",
        valor: String(l.valor_previsto),
      });
    }
  }

  // A partir de um documento (comprovante, boleto...): dados lidos servem de sugestão, conferidos pelo usuário.
  const documentoId = UUID.test(parametro(sp, "documento")) ? parametro(sp, "documento") : null;
  let aviso: string | null = null;
  if (documentoId) {
    const { data: doc } = await ctx.supabase.from("documentos").select("id, nome_original, titulo, extracao, competencia").eq("id", documentoId).eq("empresa_id", empresaId).maybeSingle();
    if (doc) {
      valores.documento_id = doc.id;
      valores.descricao = doc.titulo ?? doc.nome_original.replace(/\.[^.]+$/, "");
      const campos = ((doc.extracao as { campos?: { campo: string; valor: string; confianca: string }[] } | null)?.campos ?? []).filter((c) => c.confianca !== "baixa");
      const valor = campos.find((c) => c.campo === "valor")?.valor;
      const venc = campos.find((c) => c.campo === "vencimento" || c.campo === "data")?.valor;
      if (valor) valores.valor = valor.replace(/^R\$\s*/, "");
      if (venc && /^\d{4}-\d{2}-\d{2}$/.test(venc)) valores.data_vencimento = venc;
      valores.data_competencia = doc.competencia;
      aviso = `Dados sugeridos a partir do documento “${doc.nome_original}”. Confira antes de salvar; o documento ficará vinculado ao lançamento.`;
    }
  }

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: base, rotulo: tipo === "pagar" ? "Contas a pagar" : "Contas a receber" }}
        titulo={copiarId ? "Lançar de novo" : valores.tipo === "receber" ? "Nova receita" : "Nova despesa"}
        descricao="Única, parcelada (com datas e valores que você escolhe) ou recorrente; paga ou em aberto. Compras no cartão, maquininha, empréstimos e transferências ficam em Caixa e bancos."
      />
      {aviso ? <Alerta tom="info" className="mb-4">{aviso}</Alerta> : null}
      <Card>
        <CardContent className="pt-5">
          <FormularioLancamento empresaId={empresaId} opcoes={await carregarOpcoes(ctx, empresaId)} valores={valores} base={base} podeAnexar={ctx.pode("documentos.enviar") && ctx.pode("documentos.ver")} />
        </CardContent>
      </Card>
    </>
  );
}
