import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioLancamento, type ValoresLancamento } from "@/components/financeiro/formulario-lancamento";
import { carregarOpcoes } from "@/lib/financeiro/opcoes";
import { hojeISO } from "@/lib/competencia";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Novo lançamento" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function NovoLancamento({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos/novo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.editar")) return <Alerta tom="alerta">Seu acesso permite apenas consultar o financeiro.</Alerta>;
  const base = `/e/${empresaId}/financeiro/lancamentos`;
  const hoje = hojeISO();
  const valores: ValoresLancamento = {
    tipo: parametro(sp, "tipo") === "receber" ? "receber" : "pagar",
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
      <CabecalhoPagina voltar={{ href: base, rotulo: "Lançamentos" }} titulo="Novo lançamento" descricao="Conta a pagar ou a receber. Para compras no cartão, vendas em maquininha, empréstimos e transferências, use “Operações”." />
      {aviso ? <Alerta tom="info" className="mb-4">{aviso}</Alerta> : null}
      <Card>
        <CardContent className="pt-5">
          <FormularioLancamento empresaId={empresaId} opcoes={await carregarOpcoes(ctx, empresaId)} valores={valores} base={base} />
        </CardContent>
      </Card>
    </>
  );
}
