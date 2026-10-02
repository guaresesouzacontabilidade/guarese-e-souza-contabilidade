import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Power } from "lucide-react";
import { exigirEquipe, obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { FormularioEmpresa } from "@/components/empresas/formulario-empresa";
import { ContatosEmpresa } from "@/components/empresas/contatos";
import { ConvidarUsuario } from "@/components/usuarios/convite";
import { ListaMembros, type MembroLista } from "@/components/usuarios/lista-membros";
import { ListaContas, type ContaFinanceira } from "@/components/financeiro/contas";
import { ModelosChecklist, type ModeloChecklist } from "@/components/checklist/modelos";
import { formatarDocumento } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import type { Permissao } from "@/lib/permissoes";
import { alterarSituacaoEmpresa, atualizarEmpresa } from "../acoes";

export const metadata: Metadata = { title: "Empresa" };

export default async function PaginaEmpresa({ params, searchParams }: PageProps<"/escritorio/empresas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await exigirEquipe();
  const ctx = await obterContextoEmpresa(id);
  const aba = typeof sp.aba === "string" ? sp.aba : "dados";

  const [{ data: empresa }, { data: equipe }] = await Promise.all([
    ctx.supabase.from("empresas").select("*").eq("id", id).single(),
    ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);
  if (!empresa) return <Alerta tom="perigo">Empresa não encontrada.</Alerta>;

  const abas = [
    { valor: "dados", rotulo: "Dados cadastrais", href: `/escritorio/empresas/${id}` },
    { valor: "contatos", rotulo: "Responsáveis e contatos", href: `/escritorio/empresas/${id}?aba=contatos` },
    { valor: "usuarios", rotulo: "Usuários e permissões", href: `/escritorio/empresas/${id}?aba=usuarios` },
    { valor: "contas", rotulo: "Contas bancárias", href: `/escritorio/empresas/${id}?aba=contas` },
    { valor: "checklist", rotulo: "Checklist mensal", href: `/escritorio/empresas/${id}?aba=checklist` },
  ];

  let conteudo: React.ReactNode = null;
  if (aba === "contatos") {
    const { data } = await ctx.supabase.from("empresa_contatos").select("*").eq("empresa_id", id).order("principal", { ascending: false }).order("nome");
    conteudo = <ContatosEmpresa empresaId={id} contatos={data ?? []} podeEditar={ctx.pode("empresa.editar")} />;
  } else if (aba === "usuarios") {
    const { data } = await ctx.supabase
      .from("empresa_membros")
      .select("id, user_id, papel, permissoes, ativo, convidado_em, revogado_em, motivo_revogacao, perfil:perfis!empresa_membros_user_id_fkey(nome, email, ultimo_acesso_em)")
      .eq("empresa_id", id)
      .order("ativo", { ascending: false });
    const membros: MembroLista[] = (data ?? []).map((m) => {
      const p = m.perfil as unknown as { nome: string; email: string; ultimo_acesso_em: string | null };
      return { ...m, permissoes: m.permissoes as Permissao[], nome: p?.nome ?? "—", email: p?.email ?? "", ultimo_acesso_em: p?.ultimo_acesso_em ?? null };
    });
    conteudo = (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Defina quem acessa esta empresa e o que cada pessoa pode fazer (visualizar, enviar, baixar, aprovar, editar o financeiro...).
          </p>
          {ctx.pode("usuarios.gerenciar") ? <ConvidarUsuario empresaId={id} /> : null}
        </div>
        <ListaMembros empresaId={id} membros={membros} podeGerenciar={ctx.pode("usuarios.gerenciar")} usuarioAtualId={s.usuarioId} ehCliente={false} />
        {s.perfil.tipo === "admin" ? (
          <p className="text-xs text-muted-foreground">
            Para dar acesso a alguém da equipe, use <Link href="/escritorio/equipe" className="underline">Equipe e permissões</Link>.
          </p>
        ) : null}
      </div>
    );
  } else if (aba === "contas") {
    const { data } = await ctx.supabase.from("contas_financeiras").select("*").eq("empresa_id", id).order("ativa", { ascending: false }).order("nome");
    conteudo = <ListaContas empresaId={id} contas={(data ?? []) as ContaFinanceira[]} podeEditar={ctx.pode("financeiro.editar")} />;
  } else if (aba === "checklist") {
    const [{ data: modelos }, { data: categorias }, { data: clientes }] = await Promise.all([
      ctx.supabase.from("checklist_modelos").select("*").eq("empresa_id", id).order("ordem").order("titulo"),
      ctx.supabase.from("categorias_documento").select("codigo, nome, escritorio").eq("ativo", true).order("ordem"),
      ctx.supabase
        .from("empresa_membros")
        .select("user_id, perfil:perfis!empresa_membros_user_id_fkey(nome)")
        .eq("empresa_id", id)
        .eq("ativo", true)
        .neq("papel", "equipe"),
    ]);
    conteudo = (
      <ModelosChecklist
        empresaId={id}
        modelos={(modelos ?? []) as ModeloChecklist[]}
        categorias={categorias ?? []}
        clientes={(clientes ?? []).map((c) => ({ id: c.user_id, nome: (c.perfil as unknown as { nome: string })?.nome ?? "—" }))}
        equipe={equipe ?? []}
        podeGerenciar={ctx.pode("checklist.gerenciar")}
      />
    );
  } else {
    conteudo = (
      <Card>
        <CardContent className="pt-5">
          <FormularioEmpresa
            acao={atualizarEmpresa.bind(null, id)}
            inicial={empresa}
            equipe={equipe ?? []}
            edicao
            somenteLeitura={!ctx.pode("empresa.editar")}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {sp.criada ? (
        <Alerta tom="sucesso" className="mb-4" titulo="Empresa cadastrada">
          O plano de contas gerencial e o checklist padrão foram criados. Próximos passos: cadastre as contas bancárias e convide o empresário.
        </Alerta>
      ) : null}
      <CabecalhoPagina
        titulo={empresa.nome_fantasia ?? empresa.razao_social}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {formatarDocumento(empresa.documento)} · {REGIMES[empresa.regime_tributario]}
            {empresa.ativa ? <Badge variante="sucesso">Ativa</Badge> : <Badge>Inativa</Badge>}
            {empresa.demonstracao ? <Badge variante="alerta">Demonstração</Badge> : null}
          </span>
        }
        voltar={{ href: "/escritorio/empresas", rotulo: "Empresas" }}
        acoes={
          <>
            <Button variante="contorno" asChild>
              <Link href={`/e/${id}`}>
                Abrir área da empresa <ArrowUpRight />
              </Link>
            </Button>
            {ctx.pode("empresa.editar") ? (
              <BotaoAcao
                variante="fantasma"
                acao={alterarSituacaoEmpresa.bind(null, id, !empresa.ativa)}
                confirmar={{
                  titulo: empresa.ativa ? "Desativar empresa?" : "Reativar empresa?",
                  descricao: empresa.ativa
                    ? "Lembretes e checklists automáticos deixam de ser gerados. Dados, documentos e acessos são preservados."
                    : "A empresa volta a receber checklists e lembretes.",
                  textoConfirmar: empresa.ativa ? "Desativar" : "Reativar",
                  perigo: empresa.ativa,
                }}
              >
                <Power /> {empresa.ativa ? "Desativar" : "Reativar"}
              </BotaoAcao>
            ) : null}
          </>
        }
      />
      <AbasLink abas={abas} ativa={aba} />
      {conteudo}
    </>
  );
}
