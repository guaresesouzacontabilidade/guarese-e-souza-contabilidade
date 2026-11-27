import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { EnviarDocumentos } from "@/components/documentos/enviar-documentos";
import { competenciaAtual, listaCompetencias, somarMeses } from "@/lib/competencia";

export const metadata: Metadata = { title: "Disponibilizar documentos" };

/** O escritório disponibiliza guias, folhas, recibos, relatórios e contratos para a empresa. */
export default async function PublicarDocumentos({ params }: PageProps<"/e/[empresaId]/documentos/publicar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.publicar")) return <Alerta tom="alerta">Somente a equipe do escritório disponibiliza documentos às empresas.</Alerta>;
  const [{ data: categorias }, { data: escritorio }] = await Promise.all([
    ctx.supabase.from("categorias_documento").select("codigo, nome, descricao, extensoes").eq("ativo", true).eq("escritorio", true).order("ordem"),
    ctx.supabase.from("escritorio").select("upload_tamanho_maximo_mb").single(),
  ]);
  return (
    <>
      <CabecalhoPagina
        voltar={{ href: `/e/${empresaId}/documentos?origem=escritorio`, rotulo: "Documentos do escritório" }}
        titulo="Disponibilizar documentos à empresa"
        descricao={`Guias, folhas, recibos, relatórios e contratos para ${ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social}. A empresa é avisada no portal e por e-mail; cada visualização e download fica registrado.`}
      />
      <Alerta tom="info" className="mb-4">
        Informe vencimento e valor nas guias para que apareçam nos avisos da empresa. A visualização ou o download pelo cliente não comprovam o pagamento.
      </Alerta>
      <EnviarDocumentos
        empresaId={empresaId}
        documentoEmpresa={ctx.acesso.documento}
        categorias={categorias ?? []}
        itens={[]}
        competencias={listaCompetencias(24, 1)}
        competenciaPadrao={somarMeses(competenciaAtual(), -1).slice(0, 7)}
        limiteMb={escritorio?.upload_tamanho_maximo_mb ?? 50}
        modo="escritorio"
        baseDocumentos={`/e/${empresaId}/documentos`}
      />
    </>
  );
}
