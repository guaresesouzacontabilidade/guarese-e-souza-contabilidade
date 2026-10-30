import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { CAMPOS_ANIMAL, CAMPOS_TUTOR } from "@/lib/veterinaria/planilha-tutores";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Modelo em Excel para importar tutores e animais (uma linha por animal, com
 * os dados do tutor), com uma aba de instruções. Só para o responsável pela clínica.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "veterinaria" || !acesso.permissoes.has("gestao.gerenciar")) return new NextResponse("Acesso negado.", { status: 403 });

  const campos = [...CAMPOS_TUTOR.filter((c) => c.chave !== "tutor_codigo"), ...CAMPOS_ANIMAL];
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const ws = wb.addWorksheet("Tutores e animais", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(campos.map((c) => c.titulo));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 30 : 16));
  // Texto nas colunas de números com zero à esquerda (CPF, telefones, CEP, microchip)
  for (const chave of ["cpf", "telefone", "telefone2", "cep", "microchip"]) ws.getColumn(campos.findIndex((c) => c.chave === chave) + 1).numFmt = "@";
  const exemplo = (v: Record<string, string>) => ws.addRow(campos.map((c) => v[c.chave] ?? ""));
  const tutora = { tutor_nome: "Maria Exemplo (fictícia)", telefone: "(63) 99999-0000", email: "maria@exemplo.test", logradouro: "Rua Exemplo", numero: "100", bairro: "Centro", cidade: "Porto Nacional", uf: "TO" };
  exemplo({ ...tutora, animal_nome: "Rex", especie: "Cão", raca: "SRD", sexo: "Macho", castrado: "Sim", nascimento: "15/03/2020", porte: "Médio", peso: "18,5" });
  exemplo({ ...tutora, animal_nome: "Mimi", especie: "Gato", raca: "Siamês", sexo: "Fêmea", castrado: "Não", idade: "2 anos", alergias: "Dipirona" });

  const ajuda = wb.addWorksheet("Como preencher");
  ajuda.columns = [
    { header: "Coluna", width: 24 },
    { header: "Como preencher", width: 110 },
  ];
  ajuda.getRow(1).font = { bold: true };
  for (const c of campos) ajuda.addRow([c.titulo, c.ajuda]);
  ajuda.addRow([]);
  ajuda.addRow(["Dica", "Apague as linhas de exemplo. Uma linha por animal: o tutor com dois animais aparece em duas linhas (os dados dele podem se repetir ou ficar só na primeira)."]);
  ajuda.addRow(["", "Também dá para enviar a planilha do sistema antigo como está: o portal reconhece as colunas pelo título e você corrige o que precisar antes de gravar."]);
  ajuda.addRow(["", "Tutor já cadastrado (mesmo CPF, ou mesmo nome e telefone) não é duplicado: só recebe os animais novos. Importar de novo não duplica nada."]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-tutores-e-animais.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
