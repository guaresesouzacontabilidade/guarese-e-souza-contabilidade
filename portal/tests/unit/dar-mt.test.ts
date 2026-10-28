import { describe, expect, it } from "vitest";
import { calcularEncargos, mesesEntre } from "@/lib/dar-mt/encargos";
import { ErroDarMt, emitirDarMt, formatarIeMt, informacaoSemAcento, lerFormulario, lerResumo, linhaDigitavelDoTexto, valorParaSefaz } from "@/lib/dar-mt/robo";
import { buscarSelicMensal } from "@/lib/dar-mt/selic";

describe("DAR-MT: multa e juros do ICMS pago em atraso", () => {
  it("mais de 60 dias: multa de 20% e juros da SELIC dos meses entre + 1% (confere com o DAR emitido pela SEFAZ-MT)", () => {
    const e = calcularEncargos({ principal: "691.20", vencimento: "2026-08-20", pagamento: "2026-10-30", selic: { "2026-09": "1.08" } });
    expect(e.diasAtraso).toBe(71);
    expect(e.multaPercentual.toFixed(2)).toBe("20.00");
    expect(e.multa.toFixed(2)).toBe("138.24");
    expect(e.mesesSelic).toEqual(["2026-09"]);
    expect(e.jurosPercentual.toFixed(2)).toBe("2.08");
    expect(e.juros.toFixed(2)).toBe("14.38");
    expect(e.total.toFixed(2)).toBe("843.82");
  });
  it("pago no mês seguinte ao vencimento: 0,333% ao dia e só o 1% de juros", () => {
    const e = calcularEncargos({ principal: "1382.40", vencimento: "2026-09-21", pagamento: "2026-10-30", selic: {} });
    expect(e.diasAtraso).toBe(39);
    expect(e.multaPercentual.toFixed(3)).toBe("12.987");
    expect(e.multa.toFixed(2)).toBe("179.53");
    expect(e.juros.toFixed(2)).toBe("13.82");
    expect(e.total.toFixed(2)).toBe("1575.75");
  });
  it("pago no mesmo mês do vencimento: multa sem juros", () => {
    const e = calcularEncargos({ principal: "925.92", vencimento: "2026-10-20", pagamento: "2026-10-30", selic: {} });
    expect([e.diasAtraso, e.multa.toFixed(2), e.juros.toFixed(2), e.total.toFixed(2)]).toEqual([10, "30.83", "0.00", "956.75"]);
  });
  it("em dia: sem acréscimos", () => {
    const e = calcularEncargos({ principal: "100", vencimento: "2026-11-20", pagamento: "2026-11-10", selic: {} });
    expect([e.diasAtraso, e.multa.toFixed(2), e.juros.toFixed(2), e.total.toFixed(2)]).toEqual([0, "0.00", "0.00", "100.00"]);
  });
  it("SELIC de um mês necessário ainda não publicada: não calcula (nunca gera guia com juros a menos)", () => {
    expect(() => calcularEncargos({ principal: "100", vencimento: "2026-08-20", pagamento: "2026-11-05", selic: { "2026-09": "1.08" } })).toThrow(/10\/2026/);
    expect(mesesEntre("2026-08-20", "2026-11-05")).toEqual(["2026-09", "2026-10"]);
    expect(mesesEntre("2026-12-20", "2027-02-01")).toEqual(["2027-01"]);
  });
  it("lê a série 4390 do Banco Central", async () => {
    let pedida = "";
    const taxas = await buscarSelicMensal(["2026-10", "2026-09"], async (url) => {
      pedida = url;
      return new Response(JSON.stringify([{ data: "01/09/2026", valor: "1.08" }, { data: "01/10/2026", valor: "0.92" }]), { status: 200 });
    });
    expect(pedida).toContain("bcdata.sgs.4390");
    expect(pedida).toContain("dataInicial=01/09/2026");
    expect(taxas).toEqual({ "2026-09": "1.08", "2026-10": "0.92" });
  });
});

// Páginas fictícias no formato das do site da SEFAZ-MT (Emissão de DAR-1/AUT)
const FORM = `<html><script>var dataAtual = "28/10/2026";
var ultimoDiaUtil = "Fri Oct 30 00:00:00 AMT 2026";
ultimoDiaUtil = "30/10/2026";</script>
<td>Nome do contribuinte:&nbsp;</td><td>TRANSPORTADORA FICTICIA LTDA</td><td>Endere&ccedil;o:&nbsp;</td>
<form method="POST" ENCTYPE="multipart/form-data" name="form" id="form" action="#">
<input type="hidden" name="municipio" id="municipio" value="99999"/>
<input type="hidden" name="numrContribuinte" id="numrContribuinte" value="100000001"/>
<input type="hidden" name="pagn" id="pagn" value="emitir"/>
<input type="hidden" name="numrDocumento" value="00000000000191"/>
<input type="hidden" name="numrInscEstadual" value="131234567"/>
<input type="hidden" name="tipoContribuinte" value="1"/>
<input type="hidden" name="codgCnae" value="4930202"/>
<input type="hidden" name="valor" id="valor"/>
</form></html>`;
const RECEITAS = `<select name="tributo"><option value="0">Selecione</option><option value="1112">1112 - ICMS NORMAL - RECOLHIMENTO MENSAL</option></select>`;
const TRIBUTO = `<?xml version="1.0"?><resultado><codg-tributo-multas>8214</codg-tributo-multas><codg-tributo-juros>8419</codg-tributo-juros></resultado>`;
const resumo = (total: string) => `<html><td>Per&iacute;odo de refer&ecirc;ncia:&nbsp;</td><td>07/2026</td>
<td>Data de vencimento:&nbsp;</td><td>30/10/2026</td><td>Valor Tributo:&nbsp;</td><td>100,00</td>
<td>Valor Juros:&nbsp;</td><td>2,08</td><td>Valor Total:&nbsp;</td><td>${total}</td>
<form action="/arrecadacao/darlivre/formapagamento"><input type="hidden" name="numrDar" id="numrDar" value="300000000017"/></form></html>`;

function sefazFicticia(total: string) {
  const pedidos: { url: string; corpo: Record<string, string> }[] = [];
  const buscar = async (url: string, init?: RequestInit) => {
    const corpo: Record<string, string> = {};
    if (init?.body instanceof FormData) for (const [k, v] of init.body.entries()) corpo[k] = String(v);
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body.entries()) corpo[k] = v;
    pedidos.push({ url, corpo });
    const latin1 = (t: string) => new Response(Buffer.from(t, "latin1"), { status: 200, headers: { "content-type": "text/html;charset=ISO-8859-1", "set-cookie": "JSESSIONID=abc; path=/" } });
    if (url.endsWith("/menudarlivre")) return latin1("<html>menu</html>");
    if (url.endsWith("/tributodropdown")) return latin1(corpo.tributo ? TRIBUTO : RECEITAS);
    if (url.endsWith("/pj/gerardar")) return latin1(corpo.pagn === "formulario" ? FORM : resumo(total));
    if (url.endsWith("/formapagamento")) return new Response(Buffer.from("%PDF-1.4 ficticio"), { status: 200, headers: { "content-type": "application/pdf" } });
    return new Response("", { status: 404 });
  };
  return { pedidos, buscar };
}

const PEDIDO = {
  inscricaoEstadual: "131234567",
  periodo: "2026-07",
  receita: "1112",
  vencimentoDar: "2026-10-30",
  principal: "100.00",
  diasAtraso: 71,
  multa: "20.00",
  juros: "2.08",
  informacao: "ICMS normal - referência 07/2026",
};

describe("DAR-MT: robô do formulário público da SEFAZ-MT", () => {
  it("formata valores, inscrição e texto como o formulário pede", () => {
    expect(valorParaSefaz("1234.5")).toBe("1.234,50");
    expect(valorParaSefaz("843.82")).toBe("843,82");
    expect(formatarIeMt("131234567")).toBe("13.123.456-7");
    expect(informacaoSemAcento("ICMS normal — referência 07/2026")).toBe("ICMS NORMAL - REFERENCIA 07/2026");
  });
  it("lê o formulário, o resumo e a linha digitável", () => {
    const f = lerFormulario(FORM);
    expect(f.ocultos).toMatchObject({ pagn: "emitir", numrInscEstadual: "131234567", codgCnae: "4930202" });
    expect(f.contribuinte).toBe("TRANSPORTADORA FICTICIA LTDA");
    expect([f.dataAtual, f.ultimoDiaUtil]).toEqual(["28/10/2026", "30/10/2026"]);
    expect(lerResumo(resumo("122,08"))).toEqual({ numero: "300000000017", periodo: "07/2026", vencimento: "30/10/2026", principal: "100.00", juros: "2.08", total: "122.08" });
    expect(lerResumo("<html>Página de Erros</html>")).toBeNull();
    expect(linhaDigitavelDoTexto("... 85810000001-2 22080123202-5 61030111203-2 00000000017-0 ...")).toBe("85810000001-2 22080123202-5 61030111203-2 00000000017-0");
  });
  it("emite com os mesmos campos do navegador e devolve o número e o PDF", async () => {
    const { pedidos, buscar } = sefazFicticia("122,08");
    const dar = await emitirDarMt(PEDIDO, buscar);
    expect(dar.numero).toBe("300000000017");
    expect(dar.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const emissao = pedidos.find((p) => p.corpo.pagn === "emitir")!;
    expect(emissao.corpo).toMatchObject({
      periodoReferencia: "07/2026",
      tributo: "1112",
      tributoTad: "1112",
      dataVencimento: "30/10/2026",
      valorCampo: "100,00",
      valor: "100,00",
      diasAtraso: "71",
      valorMulta: "20,00",
      juros: "2,08",
      numrInscEstadual: "131234567",
      informacaoPrevista: "ICMS NORMAL - REFERENCIA 07/2026",
    });
    expect(pedidos.find((p) => p.url.endsWith("/pj/gerardar") && p.corpo.pagn === "formulario")?.corpo.inscricaoEstadual).toBe("13.123.456-7");
    expect(pedidos.at(-1)?.corpo).toMatchObject({ pagn: "emitirDarPdf", numrDar: "300000000017" });
  });
  it("para sem baixar o PDF quando o total da SEFAZ difere do calculado", async () => {
    const { pedidos, buscar } = sefazFicticia("130,00");
    await expect(emitirDarMt(PEDIDO, buscar)).rejects.toThrow(ErroDarMt);
    expect(pedidos.some((p) => p.url.endsWith("/formapagamento"))).toBe(false);
  });
  it("para quando a SEFAZ não abre o formulário da inscrição", async () => {
    const buscar = async (url: string) =>
      new Response(Buffer.from(url.endsWith("/pj/gerardar") ? "<html><b>Mensagem: Inscrição Estadual não cadastrada na SEFAZ</b></html>" : "<html></html>", "latin1"), { status: 200 });
    await expect(emitirDarMt(PEDIDO, buscar)).rejects.toThrow(/não abriu o formulário/);
  });
});
