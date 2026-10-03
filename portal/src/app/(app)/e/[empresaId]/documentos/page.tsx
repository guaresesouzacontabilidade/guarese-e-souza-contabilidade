import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen, Search, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { AbasLink } from "@/components/ui/abas";
import { TabelaDocumentos, type LinhaDocumento } from "@/components/documentos/tabela-documentos";
import { listaCompetencias, lerCompetencia } from "@/lib/competencia";
import { STATUS_DOCUMENTO } from "@/lib/rotulos";
import { parametro, termoBusca } from "@/lib/busca";

export const metadata: Metadata = { title: "Documentos" };
const POR_PAGINA = 30;

export default async function PaginaDocumentos({ params, searchParams }: PageProps<"/e/[empresaId]/documentos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.ver")) return <Alerta tom="alerta">Seu acesso não inclui a consulta de documentos desta empresa.</Alerta>;
  const revisor = ctx.pode("documentos.revisar");

  const origem = parametro(sp, "origem", ["cliente", "escritorio"]) || "cliente";
  const competencia = lerCompetencia(parametro(sp, "competencia"));
  // Notas trazidas pela busca automática × arquivos enviados pelas pessoas
  const fonte = origem === "cliente" ? parametro(sp, "fonte", ["automatica", "envio"]) : "";
  const categoria = parametro(sp, "categoria");
  const status = parametro(sp, "status", Object.keys(STATUS_DOCUMENTO));
  const busca = termoBusca(sp.busca);
  const conferir = parametro(sp, "conferir") === "1";
  const comZip = parametro(sp, "zip") === "1";
  const excluidos = revisor && parametro(sp, "excluidos") === "1";
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);

  let q = ctx.supabase
    .from("documentos")
    .select(
      "id, empresa_id, nome_original, titulo, categoria_codigo, competencia, status, direcao, enviado_em, tamanho, extensao, recebido_apos_fechamento, requer_conferencia, verificacao_status, processamento_status, zip_origem_id, vencimento, valor, versao_atual, sugestao, excluido_em, autor:perfis!documentos_enviado_por_fkey(nome)",
      { count: "exact" },
    )
    .eq("empresa_id", empresaId)
    .eq("upload_status", "concluido")
    .eq("direcao", origem)
    .order("enviado_em", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  q = excluidos ? q.not("excluido_em", "is", null) : q.is("excluido_em", null);
  if (competencia) q = q.eq("competencia", competencia);
  if (fonte === "automatica") q = q.eq("origem", "automatica");
  else if (fonte === "envio") q = q.neq("origem", "automatica");
  if (categoria) q = q.eq("categoria_codigo", categoria);
  if (status && origem === "cliente") q = q.eq("status", status);
  if (busca) q = q.or(`nome_original.ilike.%${busca}%,titulo.ilike.%${busca}%`);
  if (conferir) q = q.eq("requer_conferencia", true);
  if (!comZip) q = q.is("zip_origem_id", null);

  const [{ data, count, error }, { data: categorias }] = await Promise.all([
    q,
    ctx.supabase.from("categorias_documento").select("codigo, nome, escritorio").order("ordem"),
  ]);
  const nomes = new Map((categorias ?? []).map((c) => [c.codigo, c.nome]));
  const linhas: LinhaDocumento[] = (data ?? []).map((d) => ({
    id: d.id,
    empresa_id: d.empresa_id,
    nome: d.nome_original,
    titulo: d.titulo,
    categoria: nomes.get(d.categoria_codigo) ?? d.categoria_codigo,
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
  const base = `/e/${empresaId}/documentos`;
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA);
  const filtrando = Boolean(competencia || categoria || status || busca || conferir || fonte);

  return (
    <>
      <CabecalhoPagina
        titulo={ctx.equipe ? "Documentos" : "Meus documentos"}
        descricao="Tudo o que foi enviado ao escritório e o que o escritório disponibilizou para a empresa, com a situação de cada arquivo."
        acoes={
          <>
            {ctx.pode("documentos.publicar") ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/publicar`}>Disponibilizar ao cliente</Link>
              </Button>
            ) : null}
            {ctx.pode("documentos.enviar") ? (
              <Button asChild>
                <Link href={`/e/${empresaId}/enviar`}>
                  <Upload /> Enviar documentos
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AbasLink
        ativa={origem}
        abas={[
          { valor: "cliente", rotulo: "Enviados pela empresa", href: urlCom(base, {}, { origem: null }) },
          { valor: "escritorio", rotulo: "Do escritório para a empresa", href: urlCom(base, {}, { origem: "escritorio" }) },
        ]}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7" role="search">
        {origem === "escritorio" ? <input type="hidden" name="origem" value="escritorio" /> : null}
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar pelo nome do arquivo" className="pl-9" aria-label="Buscar documento" />
        </div>
        <Select name="competencia" defaultValue={competencia?.slice(0, 7) ?? ""} aria-label="Competência">
          <option value="">Todas as competências</option>
          {listaCompetencias(36, 1).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="categoria" defaultValue={categoria} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {(categorias ?? [])
            .filter((c) => c.escritorio === (origem === "escritorio"))
            .map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nome}
              </option>
            ))}
        </Select>
        {origem === "cliente" ? (
          <Select name="fonte" defaultValue={fonte} aria-label="Origem do arquivo">
            <option value="">Todos os arquivos</option>
            <option value="envio">Enviados por pessoas</option>
            <option value="automatica">Busca automática (SEFAZ e NFS-e)</option>
          </Select>
        ) : null}
        {origem === "cliente" ? (
          <Select name="status" defaultValue={status} aria-label="Situação">
            <option value="">Todas as situações</option>
            {Object.entries(STATUS_DOCUMENTO).map(([v, s]) => (
              <option key={v} value={v}>
                {s.rotulo}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
        <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2 lg:col-span-7">
          <label className="inline-flex items-center gap-2">
            <Checkbox name="zip" value="1" defaultChecked={comZip} /> Mostrar arquivos extraídos de ZIP
          </label>
          {revisor ? (
            <>
              <label className="inline-flex items-center gap-2">
                <Checkbox name="conferir" value="1" defaultChecked={conferir} /> Somente leituras a conferir
              </label>
              <label className="inline-flex items-center gap-2">
                <Checkbox name="excluidos" value="1" defaultChecked={excluidos} /> Mostrar excluídos
              </label>
            </>
          ) : null}
          {filtrando ? (
            <Link href={urlCom(base, {}, { origem: origem === "escritorio" ? "escritorio" : null })} className="text-primary underline-offset-2 hover:underline">
              Limpar filtros
            </Link>
          ) : null}
        </div>
      </form>

      {error ? <Alerta tom="perigo">Não foi possível carregar os documentos.</Alerta> : null}
      {linhas.length ? (
        <>
          <TabelaDocumentos
            linhas={linhas}
            podeBaixar={ctx.pode("documentos.baixar")}
            podeRevisar={revisor}
            empresaId={empresaId}
            base={base}
          />
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={count ?? 0} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio
          icone={FolderOpen}
          titulo={filtrando ? "Nenhum documento encontrado com estes filtros" : origem === "escritorio" ? "O escritório ainda não disponibilizou documentos" : "Nenhum documento enviado ainda"}
          descricao={origem === "cliente" && !filtrando ? "Envie extratos, notas, comprovantes e demais documentos do mês pelo botão “Enviar documentos”." : undefined}
        />
      )}
    </>
  );
}
