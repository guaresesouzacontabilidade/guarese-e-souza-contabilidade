import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { aplicarFiltrosAuditoria, detalharEvento, lerFiltrosAuditoria, limitesPeriodo } from "@/lib/auditoria/consulta";
import { descreverEvento } from "@/lib/auditoria/rotulos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { formatarDataHora } from "@/lib/formatos";
import { dadosRequisicao } from "@/lib/requisicao";

function csv(valor: unknown) {
  const t = valor === null || valor === undefined ? "" : String(valor);
  // Evita fórmulas ao abrir no Excel (injeção de CSV)
  const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Exporta o registro de atividades filtrado (somente administradores). */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  if (s.perfil.tipo !== "admin") return new NextResponse("Acesso negado.", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const hoje = hojeISO();
  const f = lerFiltrosAuditoria(sp, hoje);
  const aba = sp.aba === "arquivos" ? "arquivos" : "atividades";

  const [{ data: perfis }, { data: empresas }] = await Promise.all([
    s.supabase.from("perfis").select("id, nome"),
    s.supabase.from("empresas").select("id, razao_social, nome_fantasia"),
  ]);
  const nomeUsuario = new Map((perfis ?? []).map((p) => [p.id, p.nome]));
  const nomeEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));

  let linhas: unknown[][];
  let cabecalho: string[];
  try {
    if (aba === "atividades") {
      cabecalho = ["Data e hora", "Pessoa", "E-mail", "Empresa", "Evento", "Tabela", "Registro", "Detalhes", "IP", "Navegador"];
      const dados = await buscarTudo(
        (de, ate) =>
          aplicarFiltrosAuditoria(
            s.supabase.from("auditoria").select("ocorrido_em, user_id, user_email, empresa_id, acao, entidade, entidade_id, dados_antes, dados_depois, detalhes, ip, user_agent"),
            f,
          )
            .order("ocorrido_em", { ascending: false })
            .range(de, ate),
        20_000,
      );
      linhas = dados.map((e) => [
        formatarDataHora(e.ocorrido_em),
        e.user_id ? (nomeUsuario.get(e.user_id) ?? "") : "Sistema",
        e.user_email ?? "",
        e.empresa_id ? (nomeEmpresa.get(e.empresa_id) ?? "") : "",
        descreverEvento(e.acao, e.entidade),
        e.entidade,
        e.entidade_id ?? "",
        detalharEvento(e).join(" | "),
        e.ip ?? "",
        e.user_agent ?? "",
      ]);
    } else {
      const { de: inicio, ate: fim } = limitesPeriodo(f);
      const relatorios = sp.origem === "relatorios";
      cabecalho = ["Data e hora", "Pessoa", "Empresa", "Ação", relatorios ? "Relatório" : "Documento", "IP"];
      const filtrar = <Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q; eq: (c: string, v: string) => Q }>(q: Q) => {
        let r = q.gte("ocorrido_em", inicio).lt("ocorrido_em", fim);
        if (f.usuario) r = r.eq("user_id", f.usuario);
        if (f.empresa) r = r.eq("empresa_id", f.empresa);
        return r;
      };
      const dados: Record<string, unknown>[] = relatorios
        ? await buscarTudo(
            (de, ate) =>
              filtrar(s.supabase.from("relatorio_acessos").select("ocorrido_em, user_id, empresa_id, tipo, relatorio:relatorios_publicados(titulo, versao)"))
                .order("ocorrido_em", { ascending: false })
                .range(de, ate),
            20_000,
          )
        : await buscarTudo(
            (de, ate) =>
              filtrar(s.supabase.from("documento_acessos").select("ocorrido_em, user_id, empresa_id, tipo, ip, documento:documentos(nome_original)"))
                .order("ocorrido_em", { ascending: false })
                .range(de, ate),
            20_000,
          );
      linhas = dados.map((a) => {
        const doc = a.documento as { nome_original: string } | null | undefined;
        const rel = a.relatorio as { titulo: string; versao: number } | null | undefined;
        return [
          formatarDataHora(a.ocorrido_em as string),
          a.user_id ? (nomeUsuario.get(a.user_id as string) ?? "") : "",
          nomeEmpresa.get(a.empresa_id as string) ?? "",
          a.tipo,
          relatorios ? (rel ? `${rel.titulo} (v${rel.versao})` : "") : (doc?.nome_original ?? ""),
          (a.ip as string | undefined) ?? "",
        ];
      });
    }
  } catch (e) {
    return new NextResponse(`Falha ao exportar: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }

  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "auditoria",
    p_detalhes: { aba, inicio: f.inicio, fim: f.fim, linhas: linhas.length },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  const conteudo = [cabecalho, ...linhas].map((l) => l.map(csv).join(";")).join("\r\n");
  return new NextResponse(`\uFEFF${conteudo}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${aba}-${f.inicio}-a-${f.fim}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
