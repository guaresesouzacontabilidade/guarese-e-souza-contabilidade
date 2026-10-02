import type { Metadata } from "next";
import Link from "next/link";
import { FileInput, Search } from "lucide-react";
import { exigirEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { TabelaDocumentos, type LinhaDocumento } from "@/components/documentos/tabela-documentos";
import { lerCompetencia, listaCompetencias } from "@/lib/competencia";
import { STATUS_DOCUMENTO } from "@/lib/rotulos";
import { parametro, termoBusca } from "@/lib/busca";

export const metadata: Metadata = { title: "Documentos recebidos" };
const POR_PAGINA = 50;
const UUID = /^[0-9a-f-]{36}$/i;

/** Fila de conferência: documentos recebidos de todas as empresas da carteira. */
export default async function FilaDocumentos({ searchParams }: PageProps<"/escritorio/documentos">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const empresas = await obterEmpresasDoUsuario();
  const revisaveis = empresas.filter((e) => e.permissoes.has("documentos.revisar"));
  const nomes = new Map(empresas.map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));

  const situacao = parametro(sp, "situacao", ["fila", "todas", ...Object.keys(STATUS_DOCUMENTO)]) || "fila";
  const empresa = UUID.test(parametro(sp, "empresa")) ? parametro(sp, "empresa") : "";
  const competencia = lerCompetencia(parametro(sp, "competencia"));
  const categoria = parametro(sp, "categoria");
  const busca = termoBusca(sp.busca);
  const conferir = parametro(sp, "conferir") === "1";
  const aposFechamento = parametro(sp, "fechamento") === "1";
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);

  let q = s.supabase
    .from("documentos")
    .select(
      "id, empresa_id, nome_original, titulo, categoria_codigo, competencia, status, direcao, enviado_em, tamanho, extensao, recebido_apos_fechamento, requer_conferencia, verificacao_status, processamento_status, zip_origem_id, vencimento, valor, versao_atual, sugestao, autor:perfis!documentos_enviado_por_fkey(nome)",
      { count: "exact" },
    )
    .eq("direcao", "cliente")
    .eq("upload_status", "concluido")
    .is("excluido_em", null)
    .is("zip_origem_id", null)
    .order("enviado_em", { ascending: situacao === "fila" })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (situacao === "fila") q = q.in("status", ["recebido", "em_analise"]);
  else if (situacao !== "todas") q = q.eq("status", situacao);
  if (empresa) q = q.eq("empresa_id", empresa);
  if (competencia) q = q.eq("competencia", competencia);
  if (categoria) q = q.eq("categoria_codigo", categoria);
  if (busca) q = q.or(`nome_original.ilike.%${busca}%,titulo.ilike.%${busca}%`);
  if (conferir) q = q.eq("requer_conferencia", true);
  if (aposFechamento) q = q.eq("recebido_apos_fechamento", true).is("apos_fechamento_avaliado_em", null);

  const contar = (filtro: (x: ReturnType<typeof base>) => ReturnType<typeof base>) => filtro(base());
  function base() {
    return s.supabase.from("documentos").select("id", { count: "exact", head: true }).eq("direcao", "cliente").eq("upload_status", "concluido").is("excluido_em", null);
  }

  const [{ data, count }, { data: categorias }, recebidos, analise, correcao, fechamento] = await Promise.all([
    q,
    s.supabase.from("categorias_documento").select("codigo, nome").eq("escritorio", false).order("ordem"),
    contar((x) => x.eq("status", "recebido").is("zip_origem_id", null)),
    contar((x) => x.eq("status", "em_analise").is("zip_origem_id", null)),
    contar((x) => x.eq("status", "correcao").is("zip_origem_id", null)),
    contar((x) => x.eq("recebido_apos_fechamento", true).is("apos_fechamento_avaliado_em", null)),
  ]);
  const nomesCat = new Map((categorias ?? []).map((c) => [c.codigo, c.nome]));
  const linhas: LinhaDocumento[] = (data ?? []).map((d) => ({
    id: d.id,
    empresa_id: d.empresa_id,
    empresa_nome: nomes.get(d.empresa_id) ?? "—",
    nome: d.nome_original,
    titulo: d.titulo,
    categoria: nomesCat.get(d.categoria_codigo) ?? d.categoria_codigo,
    competencia: d.competencia,
    status: d.status,
    direcao: d.direcao,
    enviado_em: d.enviado_em,
    enviado_por: (d.autor as { nome: string } | null)?.nome ?? null,
    tamanho: d.tamanho,
    recebido_apos_fechamento: d.recebido_apos_fechamento,
    requer_conferencia: d.requer_conferencia,
    verificacao_status: d.verificacao_status,
    processamento_status: d.processamento_status,
    zip_origem_id: d.zip_origem_id,
    eh_zip: d.extensao === "zip",
    vencimento: d.vencimento,
    valor: d.valor,
    versao_atual: d.versao_atual,
    sugestao: Boolean(d.sugestao),
  }));
  const rota = "/escritorio/documentos";
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA);

  return (
    <>
      <CabecalhoPagina
        titulo="Documentos recebidos"
        descricao="Fila de conferência de todas as empresas da carteira, dos mais antigos para os mais recentes. A aprovação é conferência interna e não representa validação fiscal."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Aguardando conferência" valor={recebidos.count ?? 0} tom={(recebidos.count ?? 0) > 0 ? "info" : "neutro"} href={urlCom(rota, {}, { situacao: "recebido" })} />
        <Indicador rotulo="Em análise" valor={analise.count ?? 0} tom="alerta" href={urlCom(rota, {}, { situacao: "em_analise" })} />
        <Indicador rotulo="Aguardando correção do cliente" valor={correcao.count ?? 0} tom={(correcao.count ?? 0) > 0 ? "perigo" : "neutro"} href={urlCom(rota, {}, { situacao: "correcao" })} />
        <Indicador rotulo="Recebidos após fechamento" valor={fechamento.count ?? 0} detalhe="sem avaliação" tom={(fechamento.count ?? 0) > 0 ? "alerta" : "neutro"} href={urlCom(rota, {}, { situacao: "todas", fechamento: "1" })} />
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Nome do arquivo" className="pl-9" aria-label="Buscar documento" />
        </div>
        <Select name="empresa" defaultValue={empresa} aria-label="Empresa">
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome_fantasia ?? e.razao_social}
            </option>
          ))}
        </Select>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação">
          <option value="fila">A conferir (recebidos e em análise)</option>
          <option value="todas">Todas as situações</option>
          {Object.entries(STATUS_DOCUMENTO).map(([v, x]) => (
            <option key={v} value={v}>
              {x.rotulo}
            </option>
          ))}
        </Select>
        <Select name="competencia" defaultValue={competencia?.slice(0, 7) ?? ""} aria-label="Competência">
          <option value="">Todas as competências</option>
          {listaCompetencias(24, 1).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="categoria" defaultValue={categoria} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {(categorias ?? []).map((c) => (
            <option key={c.codigo} value={c.codigo}>
              {c.nome}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2 lg:col-span-5">
          <label className="inline-flex items-center gap-2">
            <Checkbox name="conferir" value="1" defaultChecked={conferir} /> Somente leituras a conferir
          </label>
          <label className="inline-flex items-center gap-2">
            <Checkbox name="fechamento" value="1" defaultChecked={aposFechamento} /> Recebidos após o fechamento (sem avaliação)
          </label>
          <Link href={rota} className="text-primary underline-offset-2 hover:underline">
            Limpar filtros
          </Link>
        </div>
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>
      {linhas.length ? (
        <>
          <TabelaDocumentos linhas={linhas} podeBaixar podeRevisar={revisaveis.length > 0} multiempresa />
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={count ?? 0} montarHref={(p) => urlCom(rota, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio icone={FileInput} titulo={situacao === "fila" ? "Nenhum documento aguardando conferência" : "Nenhum documento encontrado"} descricao="Novos envios dos clientes aparecem aqui automaticamente." />
      )}
    </>
  );
}
