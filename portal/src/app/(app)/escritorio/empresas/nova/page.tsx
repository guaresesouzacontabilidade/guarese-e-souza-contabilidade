import type { Metadata } from "next";
import { exigirAdmin } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioEmpresa } from "@/components/empresas/formulario-empresa";
import { criarEmpresa } from "../acoes";

export const metadata: Metadata = { title: "Nova empresa" };

export default async function PaginaNovaEmpresa() {
  const s = await exigirAdmin();
  const { data: equipe } = await s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome");
  return (
    <>
      <CabecalhoPagina
        titulo="Nova empresa"
        descricao="Ao cadastrar, o portal cria o plano de contas gerencial e o checklist mensal padrão conforme o regime e os serviços."
        voltar={{ href: "/escritorio/empresas", rotulo: "Empresas" }}
      />
      <Card>
        <CardContent className="pt-5">
          <FormularioEmpresa acao={criarEmpresa} equipe={equipe ?? []} />
        </CardContent>
      </Card>
    </>
  );
}
