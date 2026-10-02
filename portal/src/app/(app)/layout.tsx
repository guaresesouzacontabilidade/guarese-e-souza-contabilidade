import { AppShell } from "@/components/layout/app-shell";
import { BannerAmbiente } from "@/components/layout/banner-ambiente";
import { exigirSessao, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { envServidor } from "@/lib/env-servidor";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  const [empresas, escritorio, naoLidas] = await Promise.all([
    obterEmpresasDoUsuario(),
    obterEscritorioPublico(),
    sessao.supabase.from("notificacoes").select("id", { count: "exact", head: true }).is("lida_em", null),
  ]);
  return (
    <>
      <BannerAmbiente />
      <AppShell
        usuario={{ id: sessao.usuarioId, nome: sessao.perfil.nome, email: sessao.perfil.email, tipo: sessao.perfil.tipo as "admin" | "equipe" | "cliente" }}
        empresas={empresas.map((e) => ({
          id: e.id,
          nome: e.nome_fantasia ?? e.razao_social,
          documento: e.documento,
          papel: e.papel,
          permissoes: [...e.permissoes],
          demonstracao: e.demonstracao,
        }))}
        logoUrl={escritorio.logoUrl}
        naoLidas={naoLidas.count ?? 0}
        chavePush={envServidor.push()?.publica ?? null}
      >
        {children}
      </AppShell>
    </>
  );
}
