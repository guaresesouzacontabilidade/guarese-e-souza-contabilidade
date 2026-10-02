import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcoesUsuario, FormEditarUsuario, VinculosUsuario, VincularEmpresas, type VinculoUsuario } from "@/components/usuarios/equipe";
import { descreverEvento } from "@/lib/auditoria/rotulos";
import { formatarDataHora, formatarDocumento, formatarRelativo, formatarTelefone } from "@/lib/formatos";
import { ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";

export const metadata: Metadata = { title: "Usuário" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function PaginaUsuario({ params }: PageProps<"/escritorio/equipe/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const s = await exigirAdmin();

  const { data: p } = await s.supabase
    .from("perfis")
    .select("id, nome, email, telefone, tipo, cargo, ativo, ultimo_acesso_em, anonimizado_em, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const [{ data: seg }, { data: vinculosBrutos }, { data: convite }, { data: atividades }, { data: empresas }] = await Promise.all([
    s.supabase.rpc("seguranca_usuarios").eq("user_id", id).maybeSingle(),
    s.supabase
      .from("empresa_membros")
      .select("id, empresa_id, papel, permissoes, ativo, convidado_em, revogado_em, motivo_revogacao, empresa:empresas(razao_social, nome_fantasia)")
      .eq("user_id", id)
      .order("ativo", { ascending: false })
      .order("convidado_em", { ascending: false }),
    s.supabase.from("convites").select("status, envio_status, created_at, ultimo_envio_em").eq("user_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    s.supabase
      .from("auditoria")
      .select("id, ocorrido_em, acao, entidade, ip, user_id, user_email")
      .or(`user_id.eq.${id},and(entidade.eq.perfis,entidade_id.eq.${id})`)
      .order("ocorrido_em", { ascending: false })
      .limit(12),
    p.tipo === "equipe" ? s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento").eq("ativa", true).order("razao_social") : Promise.resolve({ data: [] }),
  ]);

  const vinculos: VinculoUsuario[] = (vinculosBrutos ?? []).map((v) => {
    const e = v.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
    return {
      id: v.id,
      empresa_id: v.empresa_id,
      empresa_nome: e ? (e.nome_fantasia ?? e.razao_social) : "Empresa",
      papel: v.papel,
      permissoes: v.permissoes as Permissao[],
      ativo: v.ativo,
      convidado_em: v.convidado_em,
      revogado_em: v.revogado_em,
      motivo_revogacao: v.motivo_revogacao,
    };
  });
  const vinculadas = new Set(vinculos.filter((v) => v.ativo).map((v) => v.empresa_id));
  const paraVincular = (empresas ?? [])
    .filter((e) => !vinculadas.has(e.id))
    .map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social, documento: formatarDocumento(e.documento) }));

  const proprio = p.id === s.usuarioId;
  const anonimizado = Boolean(p.anonimizado_em);
  const situacao = anonimizado ? (
    <Badge variante="neutro">Anonimizado</Badge>
  ) : !p.ativo ? (
    <Badge variante="perigo">Desativado</Badge>
  ) : !p.ultimo_acesso_em && convite?.status === "pendente" ? (
    <Badge variante="alerta">Convite pendente</Badge>
  ) : (
    <Badge variante="sucesso">Ativo</Badge>
  );
  const voltar = p.tipo === "cliente" ? "/escritorio/equipe?aba=clientes" : "/escritorio/equipe";

  return (
    <>
      <Link href={voltar} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Equipe e permissões
      </Link>
      <CabecalhoPagina titulo={p.nome} descricao={`${p.email} · ${ROTULO_PAPEL[p.tipo] ?? p.tipo}${p.cargo ? ` · ${p.cargo}` : ""}`} acoes={situacao} />

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acesso</CardTitle>
              <CardDescription>
                {p.tipo === "admin"
                  ? "Administradores acessam todas as empresas, a equipe, as configurações e o registro de atividades."
                  : p.tipo === "equipe"
                    ? "A equipe acessa somente as empresas vinculadas abaixo, com as permissões definidas em cada uma."
                    : "Clientes acessam somente as empresas às quais foram convidados."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!anonimizado ? <FormEditarUsuario usuarioId={p.id} tipo={p.tipo} cargo={p.cargo} proprio={proprio} /> : null}
              <AcoesUsuario usuarioId={p.id} nome={p.nome} ativo={p.ativo} anonimizado={anonimizado} proprio={proprio} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Empresas</CardTitle>
              <CardDescription>
                {p.tipo === "admin"
                  ? "Como administrador, esta pessoa já acessa todas as empresas."
                  : p.tipo === "equipe"
                    ? "Vincule as empresas que esta pessoa atende e ajuste as permissões em cada uma."
                    : "Para convidar ou mudar permissões de clientes, use a aba “Usuários e permissões” no cadastro da empresa."}
              </CardDescription>
            </CardHeader>
            {p.tipo !== "admin" ? (
              <CardContent className="space-y-4">
                <VinculosUsuario
                  usuario={{ id: p.id, nome: p.nome, email: p.email, ultimo_acesso_em: p.ultimo_acesso_em }}
                  vinculos={vinculos}
                  editavel={p.tipo === "equipe" && !anonimizado}
                />
                {p.tipo === "equipe" && p.ativo && !anonimizado ? <VincularEmpresas usuarioId={p.id} empresas={paraVincular} /> : null}
              </CardContent>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Segurança</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Verificação em duas etapas</dt>
                  <dd>{seg?.tem_2fa ? <Badge variante="sucesso">Ativada</Badge> : <Badge variante="neutro">Não ativada</Badge>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Sessões abertas</dt>
                  <dd>
                    {seg?.sessoes ?? 0}
                    {seg?.ultima_atividade ? <span className="text-muted-foreground"> · última atividade {formatarRelativo(seg.ultima_atividade)}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Último acesso</dt>
                  <dd>{p.ultimo_acesso_em ? formatarDataHora(p.ultimo_acesso_em) : "Nunca acessou"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cadastro</dt>
                  <dd>{formatarDataHora(p.created_at)}</dd>
                </div>
                {p.telefone ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Telefone</dt>
                    <dd>{formatarTelefone(p.telefone)}</dd>
                  </div>
                ) : null}
                {convite ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Convite</dt>
                    <dd>
                      {convite.status === "aceito" ? "Aceito" : convite.status === "cancelado" ? "Cancelado" : "Aguardando a pessoa definir a senha"}
                      {convite.envio_status === "email_nao_configurado" && convite.status === "pendente" ? (
                        <span className="block text-xs text-muted-foreground">Enviado por link (e-mail não configurado).</span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Atividade recente</CardTitle>
              <p className="text-xs text-muted-foreground">Ações desta pessoa e alterações feitas no cadastro dela.</p>
              <CardDescription>
                <Link href={`/escritorio/auditoria?usuario=${p.id}`} className="underline">
                  Ver todo o registro de atividades
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {atividades?.length ? (
                <ol className="space-y-2.5 text-sm">
                  {atividades.map((a) => (
                    <li key={a.id}>
                      <p>{descreverEvento(a.acao, a.entidade)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatarDataHora(a.ocorrido_em)}
                        {a.user_id !== p.id ? ` · por ${a.user_email ?? "sistema"}` : ""}
                        {a.ip ? ` · IP ${a.ip}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
              )}
            </CardContent>
          </Card>
          {anonimizado ? <Alerta tom="info">Dados pessoais anonimizados em {formatarDataHora(p.anonimizado_em)}.</Alerta> : null}
        </div>
      </div>
    </>
  );
}
