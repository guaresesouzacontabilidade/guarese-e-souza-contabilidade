import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { FormularioEmpresa } from "@/components/empresas/formulario-empresa";
import { ContatosEmpresa } from "@/components/empresas/contatos";
import { ConvidarUsuario } from "@/components/usuarios/convite";
import { ListaMembros } from "@/components/usuarios/lista-membros";
import { ModelosChecklist } from "@/components/checklist/modelos";
import { PreferenciaNotificacoes } from "@/components/configuracoes/empresa";
import { carregarChecklist, carregarMembros } from "@/lib/empresas/configuracao";
import { formatarCep, formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { REGIMES, SERVICOS } from "@/lib/rotulos";
import { GRUPOS_PERMISSOES, ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";
import { parametro } from "@/lib/busca";
import { atualizarEmpresa } from "@/app/(app)/escritorio/empresas/acoes";

export const metadata: Metadata = { title: "Configurações da empresa" };

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children || "—"}</dd>
    </div>
  );
}

/** Configurações da empresa: cadastro, contatos, usuários, checklist e o acesso do próprio usuário. */
export default async function ConfiguracoesEmpresa({ params, searchParams }: PageProps<"/e/[empresaId]/configuracoes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const { acesso, sessao, equipe } = ctx;
  const base = `/e/${empresaId}/configuracoes`;
  const gerenciaUsuarios = ctx.pode("usuarios.gerenciar");
  const verUsuarios = equipe || gerenciaUsuarios;
  const verChecklist = equipe;

  const abas = [
    { valor: "dados", rotulo: "Dados da empresa", href: base },
    { valor: "contatos", rotulo: "Responsáveis e contatos", href: `${base}?aba=contatos` },
    ...(verUsuarios ? [{ valor: "usuarios", rotulo: "Usuários e permissões", href: `${base}?aba=usuarios` }] : []),
    ...(verChecklist ? [{ valor: "checklist", rotulo: "Checklist mensal", href: `${base}?aba=checklist` }] : []),
    { valor: "acesso", rotulo: "Meu acesso e notificações", href: `${base}?aba=acesso` },
  ];
  const aba = parametro(sp, "aba", abas.map((a) => a.valor)) || "dados";

  let conteudo: React.ReactNode = null;
  if (aba === "contatos") {
    const { data } = await ctx.supabase.from("empresa_contatos").select("*").eq("empresa_id", empresaId).order("principal", { ascending: false }).order("nome");
    conteudo = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Sócios e responsáveis usados pelo escritório para contato. Os contatos marcados recebem os lembretes de documentos por WhatsApp, quando ativado.
        </p>
        <ContatosEmpresa empresaId={empresaId} contatos={data ?? []} podeEditar={ctx.pode("empresa.editar")} />
      </div>
    );
  } else if (aba === "usuarios") {
    const membros = await carregarMembros(ctx.supabase, empresaId);
    const limiteCliente = [...acesso.permissoes].filter((p) => p !== "usuarios.gerenciar");
    conteudo = (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {equipe
              ? "Defina quem acessa esta empresa e o que cada pessoa pode fazer (visualizar, enviar, baixar, aprovar, editar o financeiro...)."
              : "Convide colaboradores da sua empresa e defina o que cada um pode fazer. Você só pode conceder permissões que você mesmo possui."}
          </p>
          {gerenciaUsuarios ? (
            equipe ? (
              <ConvidarUsuario empresaId={empresaId} />
            ) : (
              <ConvidarUsuario empresaId={empresaId} podeTitular={false} limitePermissoes={limiteCliente} rotuloBotao="Convidar colaborador" />
            )
          ) : null}
        </div>
        {!gerenciaUsuarios ? <Alerta tom="info">Você pode consultar os acessos desta empresa, mas não tem permissão para alterá-los.</Alerta> : null}
        <ListaMembros empresaId={empresaId} membros={membros} podeGerenciar={gerenciaUsuarios} usuarioAtualId={sessao.usuarioId} ehCliente={!equipe} />
      </div>
    );
  } else if (aba === "checklist") {
    const dados = await carregarChecklist(ctx.supabase, empresaId);
    conteudo = <ModelosChecklist empresaId={empresaId} {...dados} podeGerenciar={ctx.pode("checklist.gerenciar")} />;
  } else if (aba === "acesso") {
    const permissoes = acesso.permissoes;
    const prefs = sessao.perfil.preferencias as Record<string, unknown> | null;
    const emailAtivo = prefs?.email_notificacoes !== false && prefs?.email_notificacoes !== "false";
    conteudo = (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Meu acesso nesta empresa</CardTitle>
            <CardDescription>
              {sessao.perfil.nome} · {sessao.perfil.email} · <Badge variante="primario">{ROTULO_PAPEL[acesso.papel] ?? acesso.papel}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {acesso.papel === "admin" ? (
              <Alerta tom="info">Administradores do escritório têm todas as permissões em todas as empresas.</Alerta>
            ) : !equipe ? (
              <p className="text-sm text-muted-foreground">
                As permissões são definidas pelo escritório{acesso.papel === "cliente_colaborador" ? " ou pelo empresário titular" : ""}. Para mudar algo, fale com quem gerencia os
                acessos da empresa.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {GRUPOS_PERMISSOES.map((g) => (
                <div key={g.grupo} className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.grupo}</p>
                  <ul className="space-y-1.5">
                    {g.itens.map((i) => {
                      const tem = permissoes.has(i.chave as Permissao);
                      return (
                        <li key={i.chave} className={`flex items-start gap-2 text-sm ${tem ? "" : "text-muted-foreground"}`}>
                          {tem ? <Check className="mt-0.5 size-4 shrink-0 text-sucesso" aria-label="Permitido" /> : <Minus className="mt-0.5 size-4 shrink-0" aria-label="Não permitido" />}
                          <span>
                            {i.rotulo}
                            <span className="block text-xs text-muted-foreground">{i.descricao}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Notificações</CardTitle>
            <CardDescription>Como você quer ser avisado sobre novidades do portal.</CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenciaNotificacoes emailAtivo={emailAtivo} />
          </CardContent>
        </Card>
      </div>
    );
  } else if (equipe) {
    const [{ data: empresa }, { data: listaEquipe }] = await Promise.all([
      ctx.supabase.from("empresas").select("*").eq("id", empresaId).single(),
      ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    ]);
    if (!empresa) return <Alerta tom="perigo">Empresa não encontrada.</Alerta>;
    conteudo = (
      <Card>
        <CardContent className="pt-5">
          <FormularioEmpresa acao={atualizarEmpresa.bind(null, empresaId)} inicial={empresa} equipe={listaEquipe ?? []} edicao somenteLeitura={!ctx.pode("empresa.editar")} />
        </CardContent>
      </Card>
    );
  } else {
    const { data: empresa } = await ctx.supabase
      .from("empresas")
      .select(
        "razao_social, nome_fantasia, tipo_pessoa, documento, inscricao_estadual, inscricao_municipal, regime_tributario, atividade_principal, cnae, logradouro, numero, complemento, bairro, cidade, uf, cep, email, telefone, servicos, data_inicio_atendimento, contador:perfis!empresas_contador_responsavel_id_fkey(nome)",
      )
      .eq("id", empresaId)
      .single();
    if (!empresa) return <Alerta tom="perigo">Empresa não encontrada.</Alerta>;
    const contador = empresa.contador as unknown as { nome: string } | null;
    const endereco = [
      [empresa.logradouro, empresa.numero].filter(Boolean).join(", "),
      empresa.complemento,
      empresa.bairro,
      [empresa.cidade, empresa.uf].filter(Boolean).join("/"),
      empresa.cep ? `CEP ${formatarCep(empresa.cep)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    conteudo = (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Cadastro da empresa</CardTitle>
            <CardDescription>Dados mantidos pelo escritório. Se algo estiver desatualizado, avise a equipe pelas mensagens.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Item rotulo="Razão social">{empresa.razao_social}</Item>
              <Item rotulo="Nome fantasia">{empresa.nome_fantasia}</Item>
              <Item rotulo={empresa.tipo_pessoa === "PF" ? "CPF" : "CNPJ"}>{formatarDocumento(empresa.documento)}</Item>
              <Item rotulo="Regime tributário">{REGIMES[empresa.regime_tributario] ?? empresa.regime_tributario}</Item>
              <Item rotulo="Inscrição estadual">{empresa.inscricao_estadual}</Item>
              <Item rotulo="Inscrição municipal">{empresa.inscricao_municipal}</Item>
              <Item rotulo="Atividade principal">{[empresa.atividade_principal, empresa.cnae ? `CNAE ${empresa.cnae}` : null].filter(Boolean).join(" · ")}</Item>
              <Item rotulo="E-mail">{empresa.email}</Item>
              <Item rotulo="Telefone">{empresa.telefone ? formatarTelefone(empresa.telefone) : null}</Item>
              <div className="sm:col-span-2 lg:col-span-3">
                <Item rotulo="Endereço">{endereco}</Item>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Atendimento do escritório</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Item rotulo="Contador responsável">{contador?.nome}</Item>
              <Item rotulo="Cliente desde">{empresa.data_inicio_atendimento ? formatarData(empresa.data_inicio_atendimento) : null}</Item>
              <Item rotulo="Serviços contratados">
                {empresa.servicos.length ? (
                  <span className="flex flex-wrap gap-1">
                    {empresa.servicos.map((sv) => (
                      <Badge key={sv} variante="contorno">
                        {SERVICOS[sv] ?? sv}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </Item>
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Configurações da empresa"
        descricao={`${acesso.nome_fantasia ?? acesso.razao_social} · ${formatarDocumento(acesso.documento)}`}
        acoes={
          equipe ? (
            <Button variante="contorno" asChild>
              <Link href={`/escritorio/empresas/${empresaId}`}>
                Abrir no cadastro do escritório <ArrowUpRight />
              </Link>
            </Button>
          ) : null
        }
      />
      <AbasLink abas={abas} ativa={aba} />
      {conteudo}
    </>
  );
}
