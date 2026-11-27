import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { ImportarTutores } from "@/components/veterinaria/importar";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";

export const metadata: Metadata = { title: "Importar tutores e animais" };

export default async function PaginaImportarTutores({ params }: PageProps<"/e/[empresaId]/veterinaria/importar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!ctx.gerente) return <Alerta tom="alerta">Só o responsável pela clínica importa tutores e animais.</Alerta>;
  // DDD da clínica para os telefones da planilha que vieram sem DDD
  const { data: empresa } = await ctx.supabase.from("empresas").select("telefone").eq("id", empresaId).maybeSingle();
  const tel = (empresa?.telefone ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const ddd = tel.length >= 10 ? tel.slice(0, 2) : "";
  return (
    <>
      <CabecalhoPagina
        titulo="Importar tutores e animais"
        descricao="Traga o cadastro do sistema antigo com uma planilha do Excel: o portal reconhece as colunas, mostra o que vai entrar e grava tudo de uma vez."
        voltar={{ href: `/e/${empresaId}/veterinaria/pacientes`, rotulo: "Tutores e animais" }}
      />
      <ImportarTutores empresaId={empresaId} dddPadrao={ddd} />
    </>
  );
}
