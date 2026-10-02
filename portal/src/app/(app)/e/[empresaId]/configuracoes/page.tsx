import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContatosEmpresa, type ContatoEmpresa } from "@/components/empresas/contatos";
import { ConvidarUsuario } from "@/components/usuarios/convite";
import { ListaMembros, type MembroLista } from "@/components/usuarios/lista-membros";
import { formatarCep, formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";

export const metadata: Metadata = { title: "Configurações da empresa" };

function Item({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor || "—"}</dd>
    </div>
  );
}

export default async function ConfiguracoesEmpresa({ params, searchParams }: PageProps<"/e/[empresaId]/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  // A equipe do escritório usa o cadastro completo da empresa.
  if (ctx.equipe) redirect(`/escritorio/empresas/${empresaId}`);
  const sp = await searchParams;
  const podeUsuarios = ctx.pode("usuarios.gerenciar");
  const aba = sp.aba === "usuarios" && podeUsuarios ? "usuarios" : "dados";
  const base = `/e/${empresaId}/configuracoes`;

  const [{ data: empresa }, { data: contatos }, escritorio] = await Promise.all([
    ctx.supabase
      .from("empresas")
      .select(
        "razao_social, nome_fantasia, documento, tipo_pessoa, regime_tributario, atividade_principal, cnae, inscricao_estadual, inscricao_municipal, logradouro, numero, complemento, bairro, cidade, uf, cep, email, telefone, data_inicio_atendimento, contador:perfis!empresas_contador_responsavel_id_fkey(nome, email, telefone)",
      )
      .eq("id", empresaId)
      .single(),
    ctx.supabase.from("empresa_contatos").select("*").eq("empresa_id", empresaId).order("principal", { ascending: false }).order("nome"),
    obterEscritorioPublico(),
  ]);
  if (!empresa) redirect(`/e/${empresaId}`);
  const contador = empresa.contador as unknown as { nome: string; email: string; telefone: string | null } | null;

  let conteudo: React.ReactNode;
  if (aba === "usuarios") {
    const { data } = await ctx.supabase
      .from("empresa_membros")
      .select("id, user_id, papel, permissoes, ativo, convidado_em, revogado_em, motivo_revogacao, perfil:perfis!empresa_membros_user_id_fkey(nome, email, ultimo_acesso_em)")
      .eq("empresa_id", empresaId)
      .order("ativo", { ascending: false });
    const membros: MembroLista[] = (data ?? []).map((m) => {
      const p = m.perfil as unknown as { nome: string; email: string; ultimo_acesso_em: string | null } | null;
      return { ...m, permissoes: m.permissoes as Permissao[], nome: p?.nome ?? "—", email: p?.email ?? "", ultimo_acesso_em: p?.ultimo_acesso_em ?? null };
    });
    const limite = [...ctx.acesso.permissoes].filter((p) => p !== "usuarios.gerenciar");
    conteudo = (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Convide colaboradores da sua empresa e escolha o que cada um pode fazer. Você só pode liberar permissões que você mesmo tem.
          </p>
          <ConvidarUsuario empresaId={empresaId} podeTitular={false} limitePermissoes={limite} rotuloBotao="Convidar colaborador" />
        </div>
        <ListaMembros empresaId={empresaId} membros={membros} podeGerenciar usuarioAtualId={ctx.sessao.usuarioId} ehCliente />
        <p className="text-xs text-muted-foreground">
          Pessoas com o papel “{ROTULO_PAPEL.equipe}” são do escritório e atendem a sua empresa. Para alterar o acesso delas, fale com o escritório.
        </p>
      </div>
    );
  } else {
    const endereco = [
      [empresa.logradouro, empresa.numero].filter(Boolean).join(", "),
      empresa.complemento,
      empresa.bairro,
      [empresa.cidade, empresa.uf].filter(Boolean).join(" – "),
      empresa.cep ? `CEP ${formatarCep(empresa.cep)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    conteudo = (
      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dados cadastrais</CardTitle>
            <CardDescription>Mantidos pelo escritório. Se algo estiver errado, avise pelas mensagens.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item rotulo="Razão social" valor={empresa.razao_social} />
              <Item rotulo="Nome fantasia" valor={empresa.nome_fantasia} />
              <Item rotulo={empresa.tipo_pessoa === "fisica" ? "CPF" : "CNPJ"} valor={formatarDocumento(empresa.documento)} />
              <Item rotulo="Regime tributário" valor={REGIMES[empresa.regime_tributario] ?? empresa.regime_tributario} />
              <Item rotulo="Atividade principal" valor={[empresa.cnae, empresa.atividade_principal].filter(Boolean).join(" — ")} />
              <Item rotulo="Inscrições" valor={[empresa.inscricao_estadual ? `IE ${empresa.inscricao_estadual}` : null, empresa.inscricao_municipal ? `IM ${empresa.inscricao_municipal}` : null].filter(Boolean).join(" · ")} />
              <div className="sm:col-span-2">
                <Item rotulo="Endereço" valor={endereco} />
              </div>
              <Item rotulo="E-mail" valor={empresa.email} />
              <Item rotulo="Telefone" valor={empresa.telefone ? formatarTelefone(empresa.telefone) : null} />
              <Item rotulo="Cliente do escritório desde" valor={empresa.data_inicio_atendimento ? formatarData(empresa.data_inicio_atendimento) : null} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seu atendimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {contador ? (
              <div>
                <p className="text-xs text-muted-foreground">Contador responsável</p>
                <p className="font-medium">{contador.nome}</p>
                <p className="text-muted-foreground">{contador.email}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs text-muted-foreground">Escritório</p>
              <p className="font-medium">{escritorio.nome_fantasia}</p>
              {escritorio.email ? <p className="text-muted-foreground">{escritorio.email}</p> : null}
              {escritorio.whatsapp ? <p className="text-muted-foreground">WhatsApp {formatarTelefone(escritorio.whatsapp)}</p> : null}
            </div>
            {ctx.pode("mensagens.usar") ? (
              <Button asChild variante="contorno" tamanho="sm">
                <Link href={`/e/${empresaId}/mensagens`}>
                  <MessagesSquare /> Enviar mensagem ao escritório
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Responsáveis e contatos</CardTitle>
            <CardDescription>Pessoas que o escritório procura para cada assunto e que recebem os lembretes de documentos.</CardDescription>
          </CardHeader>
          <CardContent>
            <ContatosEmpresa empresaId={empresaId} contatos={(contatos ?? []) as ContatoEmpresa[]} podeEditar={ctx.pode("empresa.editar")} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <CabecalhoPagina titulo="Configurações da empresa" descricao={`${empresa.nome_fantasia ?? empresa.razao_social} · ${formatarDocumento(empresa.documento)}`} />
      {podeUsuarios ? (
        <AbasLink
          abas={[
            { valor: "dados", rotulo: "Dados da empresa", href: base },
            { valor: "usuarios", rotulo: "Usuários e permissões", href: `${base}?aba=usuarios` },
          ]}
          ativa={aba}
          className="mb-5"
        />
      ) : null}
      {conteudo}
      <p className="mt-6 text-xs text-muted-foreground">
        Suas preferências pessoais (senha, verificação em duas etapas, avisos por e-mail e privacidade) ficam em{" "}
        <Link href="/conta" className="underline">
          Minha conta
        </Link>
        .
      </p>
    </>
  );
}
