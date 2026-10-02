import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { exigirSessao, ehEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Building2 } from "lucide-react";

/** Direciona cada perfil para a sua página inicial. */
export default async function Painel() {
  const s = await exigirSessao();
  if (ehEquipe(s.perfil)) redirect("/escritorio");
  const empresas = await obterEmpresasDoUsuario();
  const preferida = (await cookies()).get("empresa_atual")?.value;
  const alvo = empresas.find((e) => e.id === preferida) ?? empresas[0];
  if (alvo) redirect(`/e/${alvo.id}`);
  return (
    <EstadoVazio
      icone={Building2}
      titulo="Nenhuma empresa vinculada ao seu acesso"
      descricao="Seu usuário ainda não foi vinculado a uma empresa. Entre em contato com o escritório para liberar o acesso."
    />
  );
}
