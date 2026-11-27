import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { ListaVencimentos, NovoVencimento, type Vencimento } from "@/components/vencimentos/vencimentos";
import { situacaoVencimento } from "@/lib/vencimentos/rotulos";
import { hojeISO } from "@/lib/competencia";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Vencimentos" };

export default async function PaginaVencimentos({ params }: PageProps<"/e/[empresaId]/vencimentos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.ver")) return <Alerta tom="alerta">Seu acesso não inclui os documentos desta empresa.</Alerta>;
  const hoje = hojeISO();
  const podeEditar = ctx.pode("documentos.enviar");
  const [lista, docs] = await Promise.all([
    ctx.supabase
      .from("vencimentos")
      .select("id, tipo, descricao, numero, orgao, emissao, validade, responsavel, documento_id, situacao, observacao, documento:documentos!vencimentos_documento_fk(nome_original, titulo)")
      .eq("empresa_id", empresaId)
      .order("situacao")
      .order("validade"),
    podeEditar
      ? ctx.supabase
          .from("documentos")
          .select("id, nome_original, titulo")
          .eq("empresa_id", empresaId)
          .eq("upload_status", "concluido")
          .is("excluido_em", null)
          .order("created_at", { ascending: false })
          .limit(150)
      : Promise.resolve({ data: [] }),
  ]);
  const itens: Vencimento[] = (lista.data ?? []).map((v) => {
    const doc = v.documento as unknown as { nome_original: string; titulo: string | null } | null;
    return {
      id: v.id,
      tipo: v.tipo,
      descricao: v.descricao,
      numero: v.numero,
      orgao: v.orgao,
      emissao: v.emissao,
      validade: v.validade,
      responsavel: v.responsavel as Vencimento["responsavel"],
      documento_id: v.documento_id,
      documento_nome: doc ? (doc.titulo ?? doc.nome_original) : null,
      situacao: v.situacao as Vencimento["situacao"],
      observacao: v.observacao,
    };
  });
  const documentos = (docs.data ?? []).map((d) => ({ id: d.id, nome: d.titulo ?? d.nome_original }));
  const ativos = itens.filter((v) => v.situacao === "ativo");
  const atencao = ativos.filter((v) => situacaoVencimento(v.validade, hoje).situacao !== "em_dia");

  return (
    <>
      <CabecalhoPagina
        titulo="Vencimentos"
        descricao="Certificados digitais, alvarás, licenças e certidões da empresa. O portal avisa 30, 15 e 5 dias antes de vencer e no dia."
        acoes={podeEditar ? <NovoVencimento empresaId={empresaId} documentos={documentos} /> : null}
      />
      {lista.error ? <Alerta tom="perigo" className="mb-4">{mensagemErro(lista.error)}</Alerta> : null}
      {atencao.length ? (
        <Alerta tom={atencao.some((v) => situacaoVencimento(v.validade, hoje).tom === "perigo") ? "perigo" : "alerta"} className="mb-4">
          {atencao.length === 1 ? "1 documento precisa de atenção" : `${atencao.length} documentos precisam de atenção`}: vencidos ou vencendo nos próximos 30 dias.
        </Alerta>
      ) : null}
      {itens.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <ListaVencimentos
              empresaId={empresaId}
              itens={itens}
              documentos={documentos}
              hoje={hoje}
              podeEditar={podeEditar}
              podeExcluir={ctx.equipe && ctx.pode("empresa.editar")}
            />
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio
          icone={CalendarClock}
          titulo="Nenhum vencimento cadastrado"
          descricao="Cadastre o certificado digital, o alvará, as licenças e as certidões da empresa para receber avisos antes de vencer."
          acao={podeEditar ? <NovoVencimento empresaId={empresaId} documentos={documentos} /> : undefined}
        />
      )}
    </>
  );
}
