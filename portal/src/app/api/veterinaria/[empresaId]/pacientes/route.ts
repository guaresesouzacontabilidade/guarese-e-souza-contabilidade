import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Busca de animais da clínica (nome do animal ou do tutor, CPF, telefone ou microchip) para a agenda e os formulários. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "veterinaria" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  const busca = (req.nextUrl.searchParams.get("busca") ?? "").slice(0, 60).trim();
  if (busca.length < 2) return NextResponse.json([]);
  const termo = busca.replace(/[%,()*]/g, " ").trim();
  const digitos = busca.replace(/\D/g, "");
  // Tutores que batem pelo nome, CPF ou telefone
  let qt = s.supabase.from("vet_tutores").select("id").eq("empresa_id", empresaId).limit(30);
  qt = digitos.length >= 4 ? qt.or(`cpf.like.%${digitos}%,telefone.like.%${digitos}%,telefone2.like.%${digitos}%`) : qt.ilike("nome", `%${termo}%`);
  const { data: tutores } = await qt;
  const ids = (tutores ?? []).map((t) => t.id);
  const filtros = [`nome.ilike.%${termo}%`, `microchip.ilike.%${termo.replace(/\s/g, "")}%`];
  if (ids.length) filtros.push(`tutor_id.in.(${ids.join(",")})`);
  const { data } = await s.supabase
    .from("vet_pacientes")
    .select("id, nome, especie, tutor_id, tutor:vet_tutores(nome)")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .is("obito_em", null)
    .or(filtros.join(","))
    .order("nome")
    .limit(15);
  return NextResponse.json(
    (data ?? []).map((p) => ({ id: p.id, nome: p.nome, especie: p.especie, tutor_id: p.tutor_id, tutor: (p.tutor as unknown as { nome: string } | null)?.nome ?? "" })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
