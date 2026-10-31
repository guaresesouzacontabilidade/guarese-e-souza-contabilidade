import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { extrasDoPeriodo } from "@/lib/hotel/dados";
import { planilhaExtras } from "@/lib/hotel/planilha-extras";
import { formatarData, formatarDataHora, nomeMes } from "@/lib/formatos";
import { logosDaEmpresa } from "@/lib/marca/logos-relatorio";
import { bufferPlanilha, novaPasta } from "@/lib/relatorios/excel";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Planilha (Excel) dos serviços extras do dia (?dia=AAAA-MM-DD) ou do mês (?mes=AAAA-MM). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const dia = sp.get("dia") ?? "";
  const mes = sp.get("mes") ?? "";
  let de: string;
  let ate: string;
  let periodo: string;
  if (DIA.test(dia)) {
    de = ate = dia;
    periodo = `Dia ${formatarData(dia)}`;
  } else if (MES.test(mes)) {
    const [a, m] = mes.split("-").map(Number);
    de = `${mes}-01`;
    ate = `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
    periodo = `${nomeMes(m)} de ${a}`;
  } else return new NextResponse("Informe o dia ou o mês.", { status: 400 });
  try {
    const [linhas, logos] = await Promise.all([extrasDoPeriodo(s.supabase, empresaId, de, ate), logosDaEmpresa(s.supabase, acesso.logo_path)]);
    const wb = novaPasta();
    planilhaExtras(
      wb,
      {
        titulo: DIA.test(dia) ? "Serviços extras do dia" : "Serviços extras do mês",
        empresa: acesso.razao_social,
        periodo,
        situacao: "Conta do quarto e recibos de empresas",
        geradoEm: formatarDataHora(new Date().toISOString()),
        logos,
      },
      linhas,
    );
    const nome = nomeArquivo(["servicos-extras", DIA.test(dia) ? dia : mes, acesso.razao_social], "xlsx");
    return new NextResponse(new Uint8Array(await bufferPlanilha(wb)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar a planilha dos serviços extras", e);
    return new NextResponse("Não foi possível gerar a planilha. Tente novamente.", { status: 500 });
  }
}
