"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { exigirPermissao, obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import type { Json } from "@/lib/supabase/database.types";
import { horaTocantins, LARGURAS_BANNER, normalizarLinkBanner } from "./banners";
import { gerarChaveSite } from "./chave";
import { BUCKET_SITE, FOTO_MAX_BYTES, prepararFoto } from "./fotos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/loja`, "layout");
}

/** Quem gerencia a loja (a função do banco confere de novo e exige a loja ligada). */
const gerente = (empresaId: string) => exigirPermissao(empresaId, "gestao.gerenciar");

// -----------------------------------------------------------------------------
// Liberação do site para a empresa (só o escritório)
// -----------------------------------------------------------------------------
export async function liberarSiteLoja(empresaId: string, liberar: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.equipe) return falha("Só o escritório libera o site da loja.");
  const { error } = await ctx.supabase.rpc("loja_site_liberar", { p_empresa_id: empresaId, p_liberar: liberar });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(liberar ? "Site da loja liberado para esta empresa." : "Site da loja desligado para esta empresa. O site sai do ar; os cadastros ficam guardados.");
}

// -----------------------------------------------------------------------------
// Configuração do site
// -----------------------------------------------------------------------------
export async function salvarSiteLoja(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const erros: Record<string, string[]> = {};
  const slug = texto(fd, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) erros.slug = ["De 3 a 40 letras minúsculas, números e traço (ex.: shop-luana-araujo)."];
  const nome = texto(fd, "nome");
  if (nome.length < 2 || nome.length > 80) erros.nome = ["Nome da loja como aparece no site (2 a 80 letras)."];
  let enderecoSite = texto(fd, "endereco_site").toLowerCase().replace(/\/+$/, "");
  if (enderecoSite && !/^https?:\/\//.test(enderecoSite)) enderecoSite = `https://${enderecoSite}`;
  if (enderecoSite && !/^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(enderecoSite)) {
    erros.endereco_site = ["Use só o domínio, como https://shopluanaaraujo.com.br."];
  }
  const whatsapp = texto(fd, "whatsapp").replace(/\D/g, "");
  if (whatsapp && !/^(55)?[1-9]\d{9,10}$/.test(whatsapp)) erros.whatsapp = ["WhatsApp com DDD, como (63) 99208-8810."];
  const instagram = texto(fd, "instagram").replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) erros.instagram = ["Só o usuário, sem espaços (ex.: shopluanaaraujo)."];
  const pedidoMinimo = texto(fd, "pedido_minimo") ? lerValorBR(texto(fd, "pedido_minimo"))?.toString() ?? null : null;

  // Entregas: linhas do formulário (nome, valor, detalhe, pede endereço)
  const nomes = fd.getAll("entrega_nome").map(String);
  const valores = fd.getAll("entrega_valor").map(String);
  const detalhes = fd.getAll("entrega_detalhe").map(String);
  const enderecos = fd.getAll("entrega_endereco").map(String);
  const entregas: { nome: string; valor: string | null; detalhe: string; endereco: boolean }[] = [];
  nomes.forEach((n, i) => {
    const nomeEntrega = n.trim();
    if (!nomeEntrega) return;
    const v = (valores[i] ?? "").trim();
    const valor = v === "" ? null : lerValorBR(v)?.toString() ?? null;
    if (v !== "" && valor === null) erros[`entrega_${i}`] = ["Valor da entrega inválido."];
    entregas.push({ nome: nomeEntrega, valor, detalhe: (detalhes[i] ?? "").trim(), endereco: enderecos[i] === "sim" });
  });
  const pagamentos = fd.getAll("pagamentos").map(String);
  if (!pagamentos.length) erros.pagamentos = ["Marque pelo menos uma forma de pagamento."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { error } = await ctx.supabase.rpc("loja_site_configurar", {
    p_empresa_id: empresaId,
    p_dados: {
      ativo: fd.get("ativo") === "on",
      slug,
      nome,
      endereco_site: enderecoSite,
      whatsapp,
      instagram,
      email: texto(fd, "email"),
      endereco_loja: texto(fd, "endereco_loja"),
      cidade: texto(fd, "cidade"),
      horario: texto(fd, "horario"),
      aviso: texto(fd, "aviso"),
      sobre: texto(fd, "sobre"),
      politica_trocas: texto(fd, "politica_trocas"),
      pedido_minimo: pedidoMinimo,
      entregas,
      pagamentos,
    } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Dados do site salvos.");
}

/** Gera a chave do site (mostrada uma única vez). A anterior para de funcionar na hora. */
export async function gerarChaveSiteLoja(empresaId: string): Promise<ResultadoAcao<{ chave: string }>> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { chave, hash, inicio } = gerarChaveSite();
  const { error } = await ctx.supabase.rpc("loja_site_definir_chave", { p_empresa_id: empresaId, p_hash: hash, p_inicio: inicio });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Chave gerada. Copie agora: ela não aparece de novo.", { chave });
}

export async function desligarChaveSiteLoja(empresaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { error } = await ctx.supabase.rpc("loja_site_definir_chave", { p_empresa_id: empresaId, p_hash: null as unknown as string, p_inicio: null as unknown as string });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Chave desligada: o site deixou de ler o catálogo e de mandar pedidos.");
}

// -----------------------------------------------------------------------------
// Produto no site
// -----------------------------------------------------------------------------
export async function salvarProdutoSite(empresaId: string, produtoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(produtoId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const erros: Record<string, string[]> = {};
  const nome = texto(fd, "nome");
  if (nome && (nome.length < 2 || nome.length > 160)) erros.nome = ["De 2 a 160 letras (em branco, vale a descrição do cadastro)."];
  const descricao = String(fd.get("descricao") ?? "").trim();
  if (descricao.length > 8000) erros.descricao = ["No máximo 8.000 letras."];
  const variacoes = String(fd.get("variacoes") ?? "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (variacoes.some((v) => v.length > 60)) erros.variacoes = ["Cada opção com até 60 letras (uma por linha)."];
  if (variacoes.length > 100) erros.variacoes = ["No máximo 100 opções."];
  const precoDe = texto(fd, "preco_de") ? lerValorBR(texto(fd, "preco_de"))?.toString() ?? null : null;
  if (texto(fd, "preco_de") && !precoDe) erros.preco_de = ["Valor inválido."];
  const categoria = texto(fd, "categoria_id");
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.rpc("loja_site_produto_salvar", {
    p_empresa_id: empresaId,
    p_produto_id: produtoId,
    p_dados: {
      visivel: fd.get("visivel") === "on",
      destaque: fd.get("destaque") === "on",
      nome,
      descricao,
      categoria_id: UUID.test(categoria) ? categoria : null,
      rotulo_variacao: texto(fd, "rotulo_variacao") || "Opção",
      variacoes,
      preco_de: precoDe,
    } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Produto atualizado no site.");
}

export async function mostrarProdutosNoSite(empresaId: string, produtos: string[], visivel: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !produtos.length || produtos.some((p) => !UUID.test(p))) return falha("Escolha os produtos.");
  const ctx = await gerente(empresaId);
  const { data, error } = await ctx.supabase.rpc("loja_site_visibilidade", { p_empresa_id: empresaId, p_produtos: produtos, p_visivel: visivel });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(`${data} produto(s) ${visivel ? "no site" : "escondido(s) do site"}.`);
}

/** Grava a ordem das fotos (a primeira é a capa) e apaga do armazenamento as que saíram. */
export async function salvarFotosProduto(empresaId: string, produtoId: string, fotos: string[]): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(produtoId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { data: removidas, error } = await ctx.supabase.rpc("loja_site_produto_fotos", { p_empresa_id: empresaId, p_produto_id: produtoId, p_fotos: fotos });
  if (error) return falha(mensagemErro(error));
  if (removidas?.length) await ctx.supabase.storage.from(BUCKET_SITE).remove(removidas.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
  revalidar(empresaId);
  return sucesso("Fotos atualizadas.");
}

/** Envia fotos novas (JPEG, PNG ou WebP até 8 MB): cada uma vira dois WebP prontos para o site. */
export async function enviarFotosProduto(empresaId: string, produtoId: string, fd: FormData): Promise<ResultadoAcao<{ enviadas: number }>> {
  if (!UUID.test(empresaId) || !UUID.test(produtoId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { data: atual } = await ctx.supabase.from("loja_site_produtos").select("fotos").eq("produto_id", produtoId).maybeSingle();
  const fotos = [...(atual?.fotos ?? [])];
  const arquivos = fd.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!arquivos.length) return falha("Escolha as fotos.");
  if (fotos.length + arquivos.length > 8) return falha(`Cada produto tem até 8 fotos (já tem ${fotos.length}).`);
  const novas: string[] = [];
  for (const arq of arquivos) {
    if (arq.size > FOTO_MAX_BYTES) return falha(`"${arq.name}" passa de 8 MB.`);
    const pronta = await prepararFoto(new Uint8Array(await arq.arrayBuffer()));
    if (!pronta) return falha(`"${arq.name}" não é uma foto JPG, PNG ou WebP.`);
    const base = `${empresaId}/p/${produtoId}/${randomUUID()}`;
    const envio = await Promise.all([
      ctx.supabase.storage.from(BUCKET_SITE).upload(`${base}-p.webp`, pronta.p, { contentType: "image/webp", cacheControl: "31536000", upsert: false }),
      ctx.supabase.storage.from(BUCKET_SITE).upload(`${base}-g.webp`, pronta.g, { contentType: "image/webp", cacheControl: "31536000", upsert: false }),
    ]);
    const erro = envio.find((e) => e.error)?.error;
    if (erro) {
      await ctx.supabase.storage.from(BUCKET_SITE).remove([`${base}-p.webp`, `${base}-g.webp`, ...novas.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`])]);
      return falha(`Não foi possível enviar "${arq.name}": ${erro.message}`);
    }
    novas.push(base);
  }
  const { error } = await ctx.supabase.rpc("loja_site_produto_fotos", { p_empresa_id: empresaId, p_produto_id: produtoId, p_fotos: [...fotos, ...novas] });
  if (error) {
    await ctx.supabase.storage.from(BUCKET_SITE).remove(novas.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
    return falha(mensagemErro(error));
  }
  revalidar(empresaId);
  return sucesso(novas.length === 1 ? "Foto enviada." : `${novas.length} fotos enviadas.`, { enviadas: novas.length });
}

// -----------------------------------------------------------------------------
// Categorias do site
// -----------------------------------------------------------------------------
export async function salvarCategoriaSite(empresaId: string, categoriaId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || (categoriaId && !UUID.test(categoriaId))) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const nome = texto(fd, "nome");
  if (!nome || nome.length > 60) return falha("Revise os campos destacados.", { nome: ["Nome da categoria (até 60 letras)."] });
  const pai = texto(fd, "pai_id");
  const { error } = await ctx.supabase.rpc("loja_site_categoria_salvar", {
    p_empresa_id: empresaId,
    p_id: (categoriaId ?? null) as unknown as string,
    p_dados: { nome, pai_id: UUID.test(pai) ? pai : null, ordem: Number(texto(fd, "ordem")) || 0, ativa: fd.get("ativa") !== "off" } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(categoriaId ? "Categoria atualizada." : "Categoria criada.");
}

export async function excluirCategoriaSite(empresaId: string, categoriaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(categoriaId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { error } = await ctx.supabase.rpc("loja_site_categoria_excluir", { p_empresa_id: empresaId, p_id: categoriaId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Categoria excluída. Os produtos dela ficaram sem categoria.");
}

// -----------------------------------------------------------------------------
// Banners de campanha
// -----------------------------------------------------------------------------
export async function salvarBannerSite(empresaId: string, bannerId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  if (!UUID.test(empresaId) || (bannerId && !UUID.test(bannerId))) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const erros: Record<string, string[]> = {};
  const titulo = texto(fd, "titulo");
  if (titulo.length < 2 || titulo.length > 100) erros.titulo = ["Dê um nome ao banner (2 a 100 letras). Ele também descreve a imagem para quem usa leitor de tela."];
  const destino = texto(fd, "destino");
  const link = normalizarLinkBanner(destino === "outro" ? texto(fd, "link") : destino);
  if (link === false) erros.link = ["Cole o endereço de uma página do site (categoria, produto ou busca)."];
  const inicio = horaTocantins(texto(fd, "inicio"));
  const fim = horaTocantins(texto(fd, "fim"));
  if (inicio === false) erros.inicio = ["Data inválida."];
  if (fim === false) erros.fim = ["Data inválida."];
  if (inicio && fim && Date.parse(fim) <= Date.parse(inicio)) erros.fim = ["O fim precisa ser depois do início."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { data, error } = await ctx.supabase.rpc("loja_site_banner_salvar", {
    p_empresa_id: empresaId,
    p_id: (bannerId ?? null) as unknown as string,
    p_dados: { titulo, link, inicio, fim, ordem: Number(texto(fd, "ordem")) || 0, ativo: fd.get("ativo") === "on" } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(bannerId ? "Banner atualizado." : "Banner criado. Agora envie a imagem.", { id: data as string });
}

/** Imagem do banner (computador ou celular): vira dois WebP prontos e substitui a anterior. */
export async function enviarImagemBanner(empresaId: string, bannerId: string, tipo: "computador" | "celular", fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(bannerId) || (tipo !== "computador" && tipo !== "celular")) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const arquivo = fd.get("imagem");
  if (!(arquivo instanceof File) || !arquivo.size) return falha("Escolha a imagem.");
  if (arquivo.size > FOTO_MAX_BYTES) return falha("A imagem passa de 8 MB.");
  const { data: atual } = await ctx.supabase.from("loja_site_banners").select("imagem_computador, imagem_celular").eq("id", bannerId).eq("empresa_id", empresaId).maybeSingle();
  if (!atual) return falha("Banner não encontrado.");
  const pronta = await prepararFoto(new Uint8Array(await arquivo.arrayBuffer()), LARGURAS_BANNER[tipo]);
  if (!pronta) return falha("A imagem precisa ser JPG, PNG ou WebP.");
  const base = `${empresaId}/b/${bannerId}/${randomUUID()}`;
  const envio = await Promise.all([
    ctx.supabase.storage.from(BUCKET_SITE).upload(`${base}-p.webp`, pronta.p, { contentType: "image/webp", cacheControl: "31536000", upsert: false }),
    ctx.supabase.storage.from(BUCKET_SITE).upload(`${base}-g.webp`, pronta.g, { contentType: "image/webp", cacheControl: "31536000", upsert: false }),
  ]);
  const erroEnvio = envio.find((e) => e.error)?.error;
  if (erroEnvio) {
    await ctx.supabase.storage.from(BUCKET_SITE).remove([`${base}-p.webp`, `${base}-g.webp`]);
    return falha(`Não foi possível enviar a imagem: ${erroEnvio.message}`);
  }
  const { data: saiu, error } = await ctx.supabase.rpc("loja_site_banner_imagens", {
    p_empresa_id: empresaId,
    p_id: bannerId,
    p_computador: (tipo === "computador" ? base : atual.imagem_computador) as string,
    p_celular: (tipo === "celular" ? base : atual.imagem_celular) as string,
  });
  if (error) {
    await ctx.supabase.storage.from(BUCKET_SITE).remove([`${base}-p.webp`, `${base}-g.webp`]);
    return falha(mensagemErro(error));
  }
  if (saiu?.length) await ctx.supabase.storage.from(BUCKET_SITE).remove(saiu.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
  revalidar(empresaId);
  return sucesso(tipo === "computador" ? "Imagem do computador enviada." : "Imagem do celular enviada.");
}

/** Tira a imagem própria do celular (o celular passa a usar a do computador). */
export async function removerImagemCelularBanner(empresaId: string, bannerId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(bannerId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { data: atual } = await ctx.supabase.from("loja_site_banners").select("imagem_computador").eq("id", bannerId).eq("empresa_id", empresaId).maybeSingle();
  if (!atual) return falha("Banner não encontrado.");
  const { data: saiu, error } = await ctx.supabase.rpc("loja_site_banner_imagens", {
    p_empresa_id: empresaId,
    p_id: bannerId,
    p_computador: atual.imagem_computador as string,
    p_celular: null as unknown as string,
  });
  if (error) return falha(mensagemErro(error));
  if (saiu?.length) await ctx.supabase.storage.from(BUCKET_SITE).remove(saiu.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
  revalidar(empresaId);
  return sucesso("O celular passa a usar a imagem do computador.");
}

export async function excluirBannerSite(empresaId: string, bannerId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(bannerId)) return falha("Registro inválido.");
  const ctx = await gerente(empresaId);
  const { data: saiu, error } = await ctx.supabase.rpc("loja_site_banner_excluir", { p_empresa_id: empresaId, p_id: bannerId });
  if (error) return falha(mensagemErro(error));
  if (saiu?.length) await ctx.supabase.storage.from(BUCKET_SITE).remove(saiu.flatMap((f) => [`${f}-p.webp`, `${f}-g.webp`]));
  revalidar(empresaId);
  return sucesso("Banner excluído.");
}
