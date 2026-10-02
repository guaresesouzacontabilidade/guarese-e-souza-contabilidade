import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Alerta } from "@/components/ui/feedback";
import { ListaConversas, type LinhaConversa } from "@/components/mensagens/lista";
import { NovaConversa } from "@/components/mensagens/conversa";
import { competenciaAtual, listaCompetencias, somarMeses } from "@/lib/competencia";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Mensagens" };

export default async function MensagensEmpresa({ params, searchParams }: PageProps<"/e/[empresaId]/mensagens">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return <Alerta tom="alerta">Seu acesso não inclui a central de mensagens desta empresa.</Alerta>;
  const filtro = parametro(sp, "filtro", ["abertas", "resolvidas", "todas"]) || "abertas";
  const base = `/e/${empresaId}/mensagens`;

  let q = ctx.supabase
    .from("conversas")
    .select("id, empresa_id, assunto, tipo, status, aguardando, competencia, ultima_mensagem_em")
    .eq("empresa_id", empresaId)
    .order("ultima_mensagem_em", { ascending: false })
    .limit(200);
  if (filtro === "abertas") q = q.eq("status", "aberta");
  if (filtro === "resolvidas") q = q.eq("status", "resolvida");
  const [{ data }, { data: leituras }, { data: cat }, { data: esc }] = await Promise.all([
    q,
    ctx.supabase.from("conversa_leituras").select("conversa_id, lida_em").eq("user_id", ctx.sessao.usuarioId),
    ctx.supabase.from("categorias_documento").select("codigo, extensoes").in("codigo", [ctx.equipe ? "esc_outros" : "outros"]),
    ctx.supabase.from("escritorio").select("upload_tamanho_maximo_mb").single(),
  ]);
  const lidas = new Map((leituras ?? []).map((l) => [l.conversa_id, l.lida_em]));
  const conversas: LinhaConversa[] = (data ?? []).map((c) => ({ ...c, nao_lida: !lidas.get(c.id) || lidas.get(c.id)! < c.ultima_mensagem_em }));
  const categoriaAnexo = ctx.equipe && ctx.pode("documentos.publicar") ? "esc_outros" : "outros";

  return (
    <>
      <CabecalhoPagina
        titulo="Mensagens"
        descricao={ctx.equipe ? "Conversas e solicitações com esta empresa." : "Fale com o escritório: dúvidas, solicitações e envio de informações. Tudo fica registrado."}
        acoes={
          <NovaConversa
            empresaId={empresaId}
            equipe={ctx.equipe}
            competencias={listaCompetencias(12, 0)}
            base={base}
            anexos={{
              categoria: categoriaAnexo,
              competencia: somarMeses(competenciaAtual(), -1).slice(0, 7),
              extensoes: cat?.[0]?.extensoes ?? ["pdf", "jpg", "jpeg", "png"],
              limiteMb: esc?.upload_tamanho_maximo_mb ?? 50,
            }}
          />
        }
      />
      <AbasLink
        ativa={filtro}
        abas={[
          { valor: "abertas", rotulo: "Abertas", href: base },
          { valor: "resolvidas", rotulo: "Resolvidas", href: urlCom(base, {}, { filtro: "resolvidas" }) },
          { valor: "todas", rotulo: "Todas", href: urlCom(base, {}, { filtro: "todas" }) },
        ]}
      />
      <ListaConversas conversas={conversas} lado={ctx.equipe ? "escritorio" : "cliente"} />
    </>
  );
}
