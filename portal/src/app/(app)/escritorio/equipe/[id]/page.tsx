import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { AcessosEmpresasEquipe, AcoesUsuarioEquipe, type UsuarioEquipe, type VinculoEquipe } from "@/components/usuarios/equipe";
import { formatarDataHora, formatarTelefone } from "@/lib/formatos";
import { ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Pessoa da equipe" };

export default async function PaginaPessoaEquipe({ params }: PageProps<"/escritorio/equipe/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await exigirEquipe();
  const admin = s.perfil.tipo === "admin";

  const { data: pessoa } = await s.supabase
    .from("perfis")
    .select("id, nome, email, telefone, tipo, cargo, ativo, ultimo_acesso_em, created_at")
    .eq("id", id)
    .in("tipo", ["admin", "equipe"])
    .maybeSingle();
  if (!pessoa) notFound();

  const usuario: UsuarioEquipe = {
    id: pessoa.id,
    nome: pessoa.nome,
    email: pessoa.email,
    tipo: pessoa.tipo as UsuarioEquipe["tipo"],
    ativo: pessoa.ativo,
    cargo: pessoa.cargo,
  };
  const ehProprio = pessoa.id === s.usuarioId;

  let vinculos: VinculoEquipe[] = [];
  let empresasDisponiveis: { id: string; nome: string }[] = [];
  if (pessoa.tipo === "equipe") {
    const [membros, empresas] = await Promise.all([
      buscarTudo((de, ate) =>
        s.supabase
          .from("empresa_membros")
          .select("id, empresa_id, permissoes, ativo, convidado_em, revogado_em, motivo_revogacao, empresa:empresas!inner(razao_social, nome_fantasia, documento, ativa)")
          .eq("user_id", id)
          .eq("papel", "equipe")
          .order("ativo", { ascending: false })
          .range(de, ate),
      ),
      admin
        ? buscarTudo((de, ate) =>
            s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social").range(de, ate),
          )
        : Promise.resolve([]),
    ]);
    vinculos = membros
      .map((m) => {
        const e = m.empresa as unknown as { razao_social: string; nome_fantasia: string | null; documento: string; ativa: boolean };
        return {
          id: m.id,
          empresa_id: m.empresa_id,
          empresa_nome: e.nome_fantasia ?? e.razao_social,
          empresa_documento: e.documento,
          empresa_ativa: e.ativa,
          permissoes: m.permissoes as Permissao[],
          ativo: m.ativo,
          convidado_em: m.convidado_em,
          revogado_em: m.revogado_em,
          motivo_revogacao: m.motivo_revogacao,
        };
      })
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.empresa_nome.localeCompare(b.empresa_nome, "pt-BR"));
    const vinculadas = new Set(vinculos.filter((v) => v.ativo).map((v) => v.empresa_id));
    empresasDisponiveis = empresas
      .filter((e) => !vinculadas.has(e.id))
      .map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  return (
    <>
      <CabecalhoPagina
        titulo={pessoa.nome}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {pessoa.email} · {ROTULO_PAPEL[pessoa.tipo] ?? pessoa.tipo}
            {pessoa.cargo ? ` · ${pessoa.cargo}` : ""}
            {!pessoa.ativo ? (
              <Badge>Desativado</Badge>
            ) : !pessoa.ultimo_acesso_em ? (
              <Badge variante="alerta">Convite pendente</Badge>
            ) : (
              <Badge variante="sucesso">Ativo</Badge>
            )}
          </span>
        }
        voltar={{ href: "/escritorio/equipe", rotulo: "Equipe e permissões" }}
        acoes={admin ? <AcoesUsuarioEquipe usuario={usuario} ehProprio={ehProprio} /> : null}
      />

      {!pessoa.ativo ? (
        <Alerta tom="alerta" className="mb-4" titulo="Acesso desativado">
          Esta pessoa não consegue entrar no portal. Os vínculos e o histórico foram preservados.
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Dados de acesso</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">E-mail</dt>
                <dd className="break-all font-medium">{pessoa.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Telefone</dt>
                <dd>{pessoa.telefone ? formatarTelefone(pessoa.telefone) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Perfil</dt>
                <dd>{ROTULO_PAPEL[pessoa.tipo] ?? pessoa.tipo}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cadastrado em</dt>
                <dd>{formatarDataHora(pessoa.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Último acesso</dt>
                <dd>{pessoa.ultimo_acesso_em ? formatarDataHora(pessoa.ultimo_acesso_em) : "Nunca acessou"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Empresas e permissões</CardTitle>
            <CardDescription>
              {pessoa.tipo === "admin"
                ? "Administradores acessam todas as empresas com todas as permissões."
                : "Empresas que esta pessoa atende e o que ela pode fazer em cada uma."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pessoa.tipo === "admin" ? (
              <Alerta tom="info">
                Para limitar o acesso desta pessoa a algumas empresas, altere o perfil para “Equipe contábil” e vincule-a às empresas desejadas.
              </Alerta>
            ) : (
              <AcessosEmpresasEquipe usuario={usuario} vinculos={vinculos} empresasDisponiveis={empresasDisponiveis} podeGerenciar={admin} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
