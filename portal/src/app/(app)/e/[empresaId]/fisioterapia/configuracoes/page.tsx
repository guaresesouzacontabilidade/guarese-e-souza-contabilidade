import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { DialogoProfissional, FormConfigFisio } from "@/components/fisioterapia/configuracoes";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { crefitoTexto } from "@/lib/fisioterapia/rotulos";

export const metadata: Metadata = { title: "Configurações da clínica" };

export default async function PaginaConfigFisio({ params }: PageProps<"/e/[empresaId]/fisioterapia/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.gerente) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const [{ data: cfg }, { data: profissionais }, { data: membros }] = await Promise.all([
    ctx.supabase.from("fisio_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("fisio_profissionais").select("*, perfil:perfis(nome)").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("empresa_membros").select("user_id, perfil:perfis!empresa_membros_user_id_fkey(nome)").eq("empresa_id", empresaId).eq("ativo", true).neq("papel", "equipe"),
  ]);
  const usuarios = (membros ?? []).map((m) => ({ id: m.user_id, nome: (m.perfil as unknown as { nome: string } | null)?.nome ?? "Usuário" }));

  return (
    <>
      <CabecalhoPagina titulo="Configurações da clínica" descricao="Fisioterapeutas (com o CREFITO e o usuário de cada um), agenda, valor da sessão e mensagem de confirmação." voltar={{ href: `/e/${empresaId}/fisioterapia`, rotulo: "Painel da clínica" }} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Fisioterapeutas</CardTitle>
              <CardDescription>Só quem tem o usuário ligado ao CREFITO lê e registra o prontuário.</CardDescription>
            </div>
            <DialogoProfissional empresaId={empresaId} usuarios={usuarios} />
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {(profissionais ?? []).map((p) => (
                <li key={p.id} className={`flex items-center justify-between gap-2 py-2 ${p.ativo ? "" : "opacity-60"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} aria-hidden />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {p.nome} {p.responsavel_tecnico ? <Badge variante="info">Resp. técnico</Badge> : null} {!p.ativo ? <Badge>Inativo</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {crefitoTexto(p)}
                        {p.especialidade ? ` · ${p.especialidade}` : ""} · repasse {String(p.repasse_percentual).replace(".", ",")}% ·{" "}
                        {(p.perfil as unknown as { nome: string } | null)?.nome ? `usuário ${(p.perfil as unknown as { nome: string }).nome}` : "sem usuário"}
                      </p>
                    </div>
                  </div>
                  <DialogoProfissional empresaId={empresaId} usuarios={usuarios} profissional={{ ...p, repasse_percentual: Number(p.repasse_percentual) }} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Clínica e agenda</CardTitle>
          </CardHeader>
          <CardContent>
            {cfg ? <FormConfigFisio empresaId={empresaId} cfg={{ ...cfg, valor_sessao: Number(cfg.valor_sessao) }} /> : <p className="text-sm text-muted-foreground">Configuração criada ao ligar a gestão.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
