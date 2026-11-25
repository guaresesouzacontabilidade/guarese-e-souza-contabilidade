import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EquipeOs, FormConfigOs, ServicosOs, type ConfigOs } from "@/components/os/configuracoes";
import type { PessoaOs, ServicoOs } from "@/components/os/form-os";

export const metadata: Metadata = { title: "Serviços e equipe (OS)" };

export default async function ConfiguracoesOs({ params }: PageProps<"/e/[empresaId]/os/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("os.gerenciar")) return <Alerta tom="alerta">Só quem gerencia as ordens de serviço cadastra os serviços e a equipe.</Alerta>;
  const [{ data: servicos }, { data: equipe }, { data: cfg }] = await Promise.all([
    ctx.supabase.from("os_servicos").select("*").eq("empresa_id", empresaId).order("ativo", { ascending: false }).order("nome"),
    ctx.supabase.from("os_equipe").select("id, nome, cor, ativo").eq("empresa_id", empresaId).order("ativo", { ascending: false }).order("nome"),
    ctx.supabase.from("os_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Serviços e equipe"
        descricao="O que a loja faz, quanto tempo leva e quem faz. É daqui que saem o tempo estimado de cada OS e a previsão de entrega."
        voltar={{ href: `/e/${empresaId}/os`, rotulo: "Esteira de serviços" }}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Serviços</CardTitle>
            <CardDescription>Tempo por unidade (ex.: 4 min por chapa) mais um tempo fixo de preparação. O relatório mostra se a estimativa está certa.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServicosOs empresaId={empresaId} servicos={(servicos ?? []) as ServicoOs[]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Equipe</CardTitle>
            <CardDescription>Quem executa os serviços. A cor aparece no cartão da esteira.</CardDescription>
          </CardHeader>
          <CardContent>
            <EquipeOs empresaId={empresaId} equipe={(equipe ?? []) as PessoaOs[]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Horário, previsão e aviso ao cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <FormConfigOs empresaId={empresaId} cfg={(cfg as ConfigOs | null) ?? null} nomePadrao={ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
