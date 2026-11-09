import { NextResponse, type NextRequest } from "next/server";
import { obterVitrine } from "@/lib/portal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preço e disponibilidade atuais dos produtos da sacola (do catálogo guardado por até 1 minuto). */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((i) => UUID.test(i)).slice(0, 60);
  const { produtos } = await obterVitrine();
  const mapa = new Map(produtos.map((p) => [p.id, p]));
  const resposta: Record<string, { nome: string; preco: number; disponivel: boolean } | null> = {};
  for (const id of ids) {
    const p = mapa.get(id);
    resposta[id] = p ? { nome: p.nome, preco: p.preco, disponivel: p.disponivel } : null;
  }
  return NextResponse.json({ produtos: resposta }, { headers: { "Cache-Control": "no-store" } });
}
