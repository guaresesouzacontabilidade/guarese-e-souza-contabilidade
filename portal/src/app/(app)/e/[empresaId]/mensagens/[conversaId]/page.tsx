import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Paperclip } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { ResponderConversa } from "@/components/mensagens/conversa";
import { cn } from "@/lib/utils";
import { competenciaAtual, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Conversa" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function PaginaConversa({ params }: PageProps<"/e/[empresaId]/mensagens/[conversaId]">) {
  const { empresaId, conversaId } = await params;
  if (!UUID.test(conversaId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return <Alerta tom="alerta">Seu acesso não inclui a central de mensagens desta empresa.</Alerta>;

  const { data: conversa } = await ctx.supabase
    .from("conversas")
    .select("id, assunto, tipo, status, aguardando, competencia, created_at, documento_id, checklist_item_id")
    .eq("id", conversaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!conversa) notFound();

  const [{ data: mensagens }, { data: cat }, { data: esc }] = await Promise.all([
    ctx.supabase
      .from("mensagens")
      .select("id, corpo, interna, documento_ids, created_at, autor_id, autor:perfis!mensagens_autor_id_fkey(nome, tipo)")
      .eq("conversa_id", conversaId)
      .order("created_at"),
    ctx.supabase.from("categorias_documento").select("codigo, extensoes").in("codigo", [ctx.equipe ? "esc_outros" : "outros"]),
    ctx.supabase.from("escritorio").select("upload_tamanho_maximo_mb").single(),
    ctx.supabase.rpc("marcar_conversa_lida", { p_conversa_id: conversaId }),
  ]);
  const idsAnexos = [...new Set((mensagens ?? []).flatMap((m) => m.documento_ids))];
  const { data: anexos } = idsAnexos.length
    ? await ctx.supabase.from("documentos").select("id, nome_original, titulo").in("id", idsAnexos)
    : { data: [] as { id: string; nome_original: string; titulo: string | null }[] };
  const nomeAnexo = new Map((anexos ?? []).map((a) => [a.id, a.titulo ?? a.nome_original]));
  const base = `/e/${empresaId}`;

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: `${base}/mensagens`, rotulo: "Mensagens" }}
        titulo={conversa.assunto}
        descricao={
          <>
            {conversa.tipo === "solicitacao" ? "Solicitação do escritório" : "Mensagem"} · iniciada em {formatarDataHora(conversa.created_at)}
            {conversa.competencia ? ` · competência ${formatarCompetencia(conversa.competencia)}` : ""}
          </>
        }
        acoes={conversa.status === "resolvida" ? <Badge variante="sucesso">Resolvida</Badge> : <Badge variante="info">Aberta</Badge>}
      />
      <ol className="mb-5 space-y-3" aria-label="Mensagens">
        {(mensagens ?? []).map((m) => {
          const autor = m.autor as { nome: string; tipo: string } | null;
          const doEscritorio = autor?.tipo === "admin" || autor?.tipo === "equipe";
          const minha = m.autor_id === ctx.sessao.usuarioId;
          return (
            <li key={m.id} className={cn("flex", minha ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl border px-4 py-3 shadow-sm sm:max-w-[75%]",
                  m.interna ? "border-alerta/50 bg-alerta-bg/60" : minha ? "border-transparent bg-bege" : "border-border bg-card",
                )}
              >
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{autor?.nome ?? "Usuário removido"}</span>
                  {doEscritorio ? <span>· escritório</span> : null}
                  {m.interna ? (
                    <Badge variante="alerta">
                      <Lock /> Nota interna
                    </Badge>
                  ) : null}
                  <span>· {formatarDataHora(m.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{m.corpo}</p>
                {m.documento_ids.length ? (
                  <ul className="mt-2 space-y-1">
                    {m.documento_ids.map((id) => (
                      <li key={id}>
                        <Link href={`${base}/documentos/${id}`} className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                          <Paperclip className="size-3" /> {nomeAnexo.get(id) ?? "Documento"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <ResponderConversa
        empresaId={empresaId}
        conversaId={conversaId}
        equipe={ctx.equipe}
        status={conversa.status}
        anexos={{
          categoria: ctx.equipe && ctx.pode("documentos.publicar") ? "esc_outros" : "outros",
          competencia: somarMeses(competenciaAtual(), -1).slice(0, 7),
          extensoes: cat?.[0]?.extensoes ?? ["pdf", "jpg", "jpeg", "png"],
          limiteMb: esc?.upload_tamanho_maximo_mb ?? 50,
        }}
      />
    </>
  );
}
