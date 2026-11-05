import type { MetadataRoute } from "next";
import { arvoreCategorias, urlProduto } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { loja, categorias, produtos } = await obterVitrine();
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? loja.endereco_site ?? "").replace(/\/$/, "");
  const arvore = arvoreCategorias(categorias, produtos);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...arvore.flatMap((c) => [c, ...c.filhas]).map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...produtos.map((p) => ({ url: `${base}${urlProduto(p)}`, lastModified: p.publicado_em, changeFrequency: "weekly" as const, priority: 0.6 })),
    { url: `${base}/sobre`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/trocas`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/privacidade`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
