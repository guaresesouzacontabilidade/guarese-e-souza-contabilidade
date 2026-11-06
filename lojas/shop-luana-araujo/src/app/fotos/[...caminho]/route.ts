/**
 * Fotos dos produtos (pasta p) e imagens dos banners (pasta b) pelo endereço do
 * próprio site (/fotos/...): o site busca
 * no armazenamento do portal uma vez e a rede da Vercel guarda a foto. Cada foto
 * tem nome único e nunca muda, então pode ficar guardada por um ano. Assim o
 * portal quase não reenvia fotos, e o compartilhamento no WhatsApp mostra a
 * imagem do domínio da loja.
 */
const CAMINHO = /^[0-9a-f-]{36}\/(p|b)\/[0-9a-f-]{36}\/[0-9a-f-]{8,64}-(p|g)\.webp$/;

export async function GET(_req: Request, ctx: RouteContext<"/fotos/[...caminho]">) {
  const caminho = (await ctx.params).caminho.join("/");
  const origem = process.env.FOTOS_URL?.replace(/\/$/, "");
  if (!origem || !CAMINHO.test(caminho)) return new Response("Foto não encontrada.", { status: 404 });
  const r = await fetch(`${origem}/storage/v1/object/public/loja-site/${caminho}`, { cache: "no-store" });
  if (!r.ok || !r.body) return new Response("Foto não encontrada.", { status: r.status === 404 || r.status === 400 ? 404 : 502 });
  return new Response(r.body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
