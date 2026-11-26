import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { CAMPOS_CADASTRO } from "@/lib/gestao/planilha-cadastros";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Modelo em Excel para importar clientes ou fornecedores, com uma aba de
 * instruções. Só para quem gerencia a loja.
 */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  const empresaId = req.nextUrl.searchParams.get("empresa") ?? "";
  const papel = req.nextUrl.searchParams.get("papel") === "fornecedor" ? "fornecedor" : "cliente";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.loja || !acesso.permissoes.has("gestao.gerenciar")) return new NextResponse("Acesso negado.", { status: 403 });

  const campos = CAMPOS_CADASTRO.filter(
    (c) => !["fantasia", "cpf", "cnpj", "celular", "situacao"].includes(c.chave) && (papel === "fornecedor" || !["contato", "prazo"].includes(c.chave)),
  );
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = acesso.nome_fantasia ?? acesso.razao_social;
  const ws = wb.addWorksheet(papel === "cliente" ? "Clientes" : "Fornecedores", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(campos.map((c) => c.titulo));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5133" } };
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 34 : 18));
  // Texto nas colunas de números com zero à esquerda
  for (const chave of ["documento", "telefone", "cep", "inscricao_estadual"]) {
    const i = campos.findIndex((c) => c.chave === chave);
    if (i >= 0) ws.getColumn(i + 1).numFmt = "@";
  }
  const exemplo: Record<string, string> =
    papel === "cliente"
      ? { nome: "Maria Exemplo (fictícia)", documento: "529.982.247-25", telefone: "(63) 99999-0000", email: "maria@exemplo.test", cep: "77000-000", logradouro: "Rua Exemplo", numero: "100", bairro: "Centro", cidade: "Palmas", uf: "TO" }
      : { nome: "FORNECEDOR EXEMPLO LTDA (fictício)", documento: "11.222.333/0001-81", telefone: "(63) 3215-0000", email: "vendas@exemplo.test", cidade: "Palmas", uf: "TO", contato: "Carlos (vendas)", prazo: "28" };
  ws.addRow(campos.map((c) => exemplo[c.chave] ?? ""));

  const ajuda = wb.addWorksheet("Como preencher");
  ajuda.columns = [
    { header: "Coluna", width: 24 },
    { header: "Como preencher", width: 110 },
  ];
  ajuda.getRow(1).font = { bold: true };
  for (const c of campos) ajuda.addRow([c.titulo, c.ajuda]);
  ajuda.addRow([]);
  ajuda.addRow(["Dica", "Apague a linha de exemplo. Uma linha por cadastro. Só o Nome é obrigatório."]);
  ajuda.addRow(["", "Também dá para enviar a planilha exportada do sistema antigo (GestãoClick e outros) como está: o portal reconhece as colunas pelo título e você corrige o que precisar antes de gravar."]);
  ajuda.addRow(["", "Quem já está cadastrado (mesmo CPF/CNPJ) não é duplicado: só completa o que estiver vazio. Importar de novo não duplica nada."]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="modelo-${papel === "cliente" ? "clientes" : "fornecedores"}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
