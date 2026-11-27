"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import type { Json } from "@/lib/supabase/database.types";
import { buscarExterno, buscarTexto, ErroBusca } from "./buscar-externo";
import { ehCatalogoFacilZap, HOSTS_FOTOS, lerCatalogo, lerCategoria, lerProduto, nomeVitrine, sugestaoNcm, subcategorias } from "./facilzap";
import { BUCKET_SITE, prepararFoto } from "./fotos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnaliseFacilZap {
  base: string;
  loja: string | null;
  principais: { nome: string; total: number; sugestao: string }[];
  itens: { id: string; nome: string; categoria: string; subcategoria: string | null; posicao: number; importado: boolean }[];
}

/** Endereço da loja → base para os arquivos do catálogo ("https://loja.com.br"). */
function baseDaLoja(endereco: string): string | null {
  let e = endereco.trim();
  if (!e) return null;
  if (!/^https?:\/\//i.test(e)) e = `https://${e}`;
  try {
    const u = new URL(e.replace(/^http:/i, "https:"));
    const caminho = u.pathname.replace(/\/(catalogo\.md)?$/i, "").replace(/\/+$/, "");
    return `${u.origin}${caminho}`;
  } catch {
    return null;
  }
}

async function emParalelo<T, R>(lista: T[], quantos: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(lista.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(quantos, lista.length) }, async () => {
      while (proximo < lista.length) {
        const i = proximo++;
        saida[i] = await f(lista[i], i);
      }
    }),
  );
  return saida;
}

/** Lê o catálogo da loja na FácilZap e devolve o que será importado (nada é gravado ainda). */
export async function analisarFacilZap(empresaId: string, endereco: string): Promise<ResultadoAcao<AnaliseFacilZap>> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const base = baseDaLoja(endereco);
  if (!base) return falha("Informe o endereço da loja, como https://shopluanaaraujo.com.br.");
  let md: string;
  try {
    md = await buscarTexto(`${base}/catalogo.md`);
  } catch (e) {
    return falha(e instanceof ErroBusca ? `Não foi possível ler o catálogo: ${e.message}` : "Não foi possível ler o catálogo.");
  }
  if (!ehCatalogoFacilZap(md)) return falha("Não encontramos o catálogo da FácilZap nesse endereço. Confira o endereço da loja.");
  const catalogo = lerCatalogo(md);
  const principais = new Set(catalogo.produtos.map((p) => p.categoria));
  const paginas = await emParalelo(
    catalogo.categorias.filter((c) => !principais.has(c.nome)).slice(0, 250),
    6,
    async (c) => {
      try {
        return { nome: c.nome, produtos: lerCategoria(await buscarTexto(`${base}/categoria/${c.id}.md`, 2_000_000)).produtos };
      } catch {
        return { nome: c.nome, produtos: [] };
      }
    },
  );
  const subs = subcategorias(paginas, principais);
  const { data: feitos } = await ctx.supabase.from("loja_site_produtos").select("origem_externa").eq("empresa_id", empresaId).like("origem_externa", "facilzap:%").limit(20000);
  const importados = new Set((feitos ?? []).map((f) => f.origem_externa));
  const contagem = new Map<string, number>();
  for (const p of catalogo.produtos) contagem.set(p.categoria, (contagem.get(p.categoria) ?? 0) + 1);
  return sucesso(undefined, {
    base,
    loja: catalogo.loja,
    principais: [...contagem.entries()].map(([nome, total]) => ({ nome, total, sugestao: sugestaoNcm(nome) })).sort((a, b) => b.total - a.total),
    itens: catalogo.produtos.map((p, posicao) => ({
      id: p.id,
      nome: nomeVitrine(p.nome),
      categoria: p.categoria,
      subcategoria: subs.get(p.id) ?? null,
      posicao,
      importado: importados.has(`facilzap:${p.id}`),
    })),
  });
}

export interface ResultadoItemFz {
  id: string;
  nome: string;
  ok: boolean;
  novo?: boolean;
  fotos?: number;
  erro?: string;
}

/** Importa um lote (até 8 produtos): cadastro, estoque, textos, categoria e fotos. Cada produto é gravado à parte. */
export async function importarLoteFacilZap(
  empresaId: string,
  base: string,
  itens: { id: string; categoria: string; subcategoria: string | null; posicao: number }[],
  ncmPorCategoria: Record<string, string>,
  opcoes: { fotos: boolean },
): Promise<ResultadoAcao<{ itens: ResultadoItemFz[] }>> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  if (baseDaLoja(base) !== base) return falha("Endereço da loja inválido.");
  if (!itens.length || itens.length > 8 || itens.some((i) => !/^\d{1,12}$/.test(i.id))) return falha("Lote inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");

  const resultados = await emParalelo(itens, 4, async (item): Promise<ResultadoItemFz> => {
    let p;
    try {
      p = lerProduto(await buscarTexto(`${base}/produto/${item.id}.md`, 1_000_000), item.id);
    } catch {
      return { id: item.id, nome: item.id, ok: false, erro: "Página do produto indisponível na FácilZap." };
    }
    const nome = nomeVitrine(p.nome) || `Produto ${item.id}`;
    if (p.preco === null) return { id: item.id, nome, ok: false, erro: "Produto sem preço na FácilZap." };
    const ncm = (ncmPorCategoria[item.categoria] ?? "").replace(/\D/g, "");
    const { data, error } = await ctx.supabase.rpc("loja_site_importar", {
      p_empresa_id: empresaId,
      p_itens: [
        {
          externo: `facilzap:${item.id}`,
          codigo: (p.sku ?? `FZ${item.id}`).slice(0, 60),
          descricao: p.nome.slice(0, 120).padEnd(2, "."),
          nome: nome.slice(0, 160),
          ncm: /^\d{8}$/.test(ncm) ? ncm : null,
          preco: p.preco,
          estoque: p.estoque,
          categoria: nomeVitrine(item.categoria).slice(0, 60),
          subcategoria: item.subcategoria ? nomeVitrine(item.subcategoria).slice(0, 60) : null,
          texto: p.descricao,
          variacoes: p.variacoes.map(nomeVitrine),
          rotulo_variacao: "Opção",
          peso_kg: p.pesoKg,
          posicao: item.posicao,
        },
      ] as Json,
    });
    if (error) {
      const msg = mensagemErro(error).replace(/^[^:]+: /, "");
      return { id: item.id, nome, ok: false, erro: /NCM/.test(msg) && !ncm ? `Informe o NCM da categoria ${item.categoria}.` : msg };
    }
    const r = (data as { produto_id: string; novo: boolean; fotos: number }[])[0];
    let fotos = r.fotos ?? 0;
    // Fotos: só quando o produto ainda não tem nenhuma no site (não troca as escolhidas no portal)
    if (opcoes.fotos && fotos === 0 && p.fotos.length) {
      const novas: string[] = [];
      for (const url of p.fotos.slice(0, 5)) {
        try {
          const { bytes } = await buscarExterno(url, { maxBytes: 8_000_000, aceitar: (u) => HOSTS_FOTOS.has(u.hostname) });
          const pronta = await prepararFoto(bytes);
          if (!pronta) continue;
          const caminho = `${empresaId}/p/${r.produto_id}/${randomUUID()}`;
          const [a, b] = await Promise.all([
            ctx.supabase.storage.from(BUCKET_SITE).upload(`${caminho}-p.webp`, pronta.p, { contentType: "image/webp", cacheControl: "31536000" }),
            ctx.supabase.storage.from(BUCKET_SITE).upload(`${caminho}-g.webp`, pronta.g, { contentType: "image/webp", cacheControl: "31536000" }),
          ]);
          if (a.error || b.error) {
            await ctx.supabase.storage.from(BUCKET_SITE).remove([`${caminho}-p.webp`, `${caminho}-g.webp`]);
            continue;
          }
          novas.push(caminho);
        } catch {
          // Foto que não baixou fica de fora; as demais seguem.
        }
      }
      if (novas.length) {
        const { error: e2 } = await ctx.supabase.rpc("loja_site_produto_fotos", { p_empresa_id: empresaId, p_produto_id: r.produto_id, p_fotos: novas });
        if (e2) await ctx.supabase.storage.from(BUCKET_SITE).remove(novas.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
        else fotos = novas.length;
      }
    }
    return { id: item.id, nome, ok: true, novo: r.novo, fotos };
  });
  revalidatePath(`/e/${empresaId}/loja`, "layout");
  return sucesso(undefined, { itens: resultados });
}
