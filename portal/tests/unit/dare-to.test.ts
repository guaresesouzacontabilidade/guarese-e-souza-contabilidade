import { describe, expect, it } from "vitest";
import {
  ErroDareTo,
  conferirDareTo,
  emitirDareTo,
  enderecoDoRelatorio,
  lerCampos,
  lerGxState,
  linhaDigitavelDoTexto,
  normalizarLocal,
  numeroDoDare,
  valorBr,
  valorDoSite,
  type Buscar,
  type PedidoDareTo,
} from "@/lib/dare-to/robo";

/**
 * Simulação do DARE avulso da SEFAZ-TO (só para o teste), com os mesmos nomes
 * de página e de campo do site real (GeneXus): identificação (hnetccwkda),
 * seleção da inscrição (hnetcccnco) e formulário (hdrewp02).
 */
const BASE = "https://sefaz.to.gov.br/dare/servlet";
const estado = (extra: Record<string, unknown> = {}) =>
  `<input type="hidden" name="GXState" value='${JSON.stringify({ _EventName: "", _EventGridId: "", _EventRowId: "", GX_AJAX_KEY: "ABC", AJAX_SECURITY_TOKEN: "tok", ...extra })}'/>`;
const erro = (msg: string) => `<span class="ErrorViewer gx_ev" id="gxErrorViewer"><div>${msg}</div></span>`;

const LINHAS = [
  ["0", "1", "29.000.001-0", "WJE VAREJAO DAS MADEIRAS LTDA", "VAREJAO FILIAL", "1", "55.981.291/0001-38", "1718204", "TO"],
  ["0", "2", "29.542.854-6", "WJE VAREJAO DAS MADEIRAS LTDA", "VAREJÃO DAS MADEIRAS", "1", "55.981.291/0001-38", "1718204", "TO"],
];

interface Opcoes {
  subcodigo?: boolean;
  /** O total que a SEFAZ calcula (padrão: o valor informado). */
  totalSefaz?: string;
  confirmar?: "redirecionar" | "popup" | "erro";
}

function formulario(campos: Record<string, string>, op: Opcoes, msg = "") {
  const sel = (nome: string, ops: [string, string][], valor: string) =>
    `<select id="${nome}" name="${nome}">${ops.map(([v, t]) => `<option value="${v}"${v === valor ? ' selected="selected"' : ""}>${t}</option>`).join("")}</select>`;
  const inp = (nome: string, valor: string) => `<input type="text" id="${nome}" name="${nome}" value="${valor}"/>`;
  const ie = campos.vDREINSEST ?? "";
  return `<html><body>${msg ? erro(msg) : erro("").replace("<div></div>", "")}<form id="MAINFORM" name="MAINFORM" method="post" action="hdrewp02">
    ${inp("vDRERAZSOC", "WJE VAREJAO DAS MADEIRAS LTDA")}${inp("vDREINSEST", ie)}
    ${sel("vUFCDGORI", [["TO", "TO"]], "TO")}${sel("vMUNCDGORI", [["0", ""], ["1718204", "PORTO NACIONAL - 1718204"]], "1718204")}
    ${sel("vDRECDGMUN", [["0", ""], ["1700251", "ABREULANDIA - 1700251"], ["1718204", "PORTO NACIONAL                -    1718204"]], campos.vDRECDGMUN ?? "0")}
    ${sel("vDRETDCORI", [["5", "OUTROS A ESPECIFICAR"], ["2", "NFA - NOTA FISCAL AVULSA"]], campos.vDRETDCORI ?? "5")}
    ${inp("vDREDOCORI", "")}${inp("vDREDSCDOC", "")}${inp("vDRENROPAR", "0")}
    ${sel("vDRECDGRCT", [["0", ""], ["105", "105 - ICMS COMPLEMENTAÇÃO DE ALÍQUOTA - SIMPLES NACIONAL"], ["110", "110 - ICMS NORMAL"]], campos.vDRECDGRCT ?? "0")}
    ${sel("vSUBCDGRCT", op.subcodigo && campos.vDRECDGRCT === "105" ? [["0", ""], ["1", "1 - ALGUM"]] : [["0", ""]], "0")}
    ${inp("vDREDTAVEN", campos.vDREDTAVEN ?? "09/11/2026")}${inp("vDREREFCHAR", campos.vDREREFCHAR ?? "  /")}
    ${inp("vDREVLRPRI", campos.vDREVLRPRI ?? "0,00")}${inp("vDREVLRMLT", "0,00")}${inp("vDREVLRJUR", "0,00")}${inp("vDREVLRATM", "0,00")}${inp("vDREVLRTSE", "0,00")}
    ${inp("vDREVLRTOT", campos.vDREVLRTOT ?? "0,00")}
    <input type="button" name="BUTTON1" value="Atualizar Valores"/>
    <textarea name="vDREINFCOM" id="vDREINFCOM">${campos.vDREINFCOM ?? ""}</textarea>
    <input type="button" name="BTN_ENTER" value="Confirmar"/>
    ${estado({ CONINSEST: ie })}</form></body></html>`;
}

function servidor(op: Opcoes = {}) {
  const envios: { pagina: string; evento: string; corpo: URLSearchParams }[] = [];
  let ieEscolhida = "";
  const buscar: Buscar = async (url, init) => {
    const u = new URL(url);
    const metodo = init?.method ?? "GET";
    const corpo = new URLSearchParams(String(init?.body ?? ""));
    const pag = u.pathname.split("/").pop()!;
    const gx = corpo.get("GXState") ? (JSON.parse(corpo.get("GXState")!) as Record<string, string>) : {};
    if (metodo === "POST") envios.push({ pagina: pag, evento: gx._EventName, corpo });
    const html = (b: string, status = 200) => new Response(b, { status, headers: { "content-type": "text/html;charset=utf-8", "set-cookie": "JSESSIONID=abc; Path=/dare" } });
    // O servidor real responde com http e a porta 443
    const ir = (p: string) => new Response(null, { status: 302, headers: { location: `http://sefaz.to.gov.br:443/dare/servlet/${p}` } });
    const comSessao = String((init?.headers as Record<string, string>)?.Cookie ?? "").includes("JSESSIONID=abc");

    if (u.host !== "sefaz.to.gov.br") return html("fora", 404);
    if (pag === "hnetccwkda" && metodo === "GET")
      return html(`<form id="MAINFORM" name="MAINFORM" method="post" action="hnetccwkda"><input type="text" id="vINSCRICAOESTADUAL" name="vINSCRICAOESTADUAL" value=""/><input type="text" id="vCECPFCNPJ" name="vCECPFCNPJ" value=""/><input type="button" name="BUTTON1" value="Consultar"/>${estado()}</form>`);
    if (pag === "hnetccwkda" && metodo === "POST") {
      if (gx._EventName !== "EENTER.") return html(erro("evento?"));
      return corpo.get("vCECPFCNPJ") === "55981291000138" && comSessao ? ir("hnetcccnco") : html(`${erro("Contribuinte não cadastrado!")}<form id="MAINFORM" action="hnetccwkda">${estado()}</form>`);
    }
    if (pag === "hnetcccnco" && metodo === "GET")
      return html(`<form id="MAINFORM" name="MAINFORM" method="post" action="hnetcccnco"><input type="hidden" name="SfileContainerDataV" value='${JSON.stringify(LINHAS)}'/><input type="button" name="BUTTON1" value="Confirmar"/>${estado({ SfileContainerData: "{}" })}</form>`);
    if (pag === "hnetcccnco" && metodo === "POST") {
      const linha = gx.SFILE_ROW;
      if (!linha || gx._EventRowId !== linha || gx._EventGridId !== "17") return html(erro("Nenhuma inscrição estadual selecionada&#033;"));
      ieEscolhida = corpo.get(`vCECPFCNPJ_${linha}`) ?? "";
      return ir("hdrewp02");
    }
    if (pag === "hdrewp02" && metodo === "GET") return html(formulario({ vDREINSEST: ieEscolhida }, op));
    if (pag === "hdrewp02" && metodo === "POST") {
      const campos = Object.fromEntries(corpo.entries());
      campos.vDREINSEST = ieEscolhida;
      if (gx._EventName === "EVDRECDGRCT.CLICK.") return html(formulario(campos, op));
      if (gx._EventName === "E'CALCULAR'.") return html(formulario({ ...campos, vDREVLRTOT: op.totalSefaz ?? campos.vDREVLRPRI }, op));
      if (gx._EventName === "E'CONFIRM'.") {
        if (op.confirmar === "erro") return html(formulario(campos, op, "Data de vencimento inválida."));
        if (op.confirmar === "popup") return html(`<script>gx.ajax.dispatchCommands([{"popup":{"url":"adrerel02?987,1"}}])</script>`);
        return ir("adrerel02?987,1");
      }
    }
    if (pag === "adrerel02") return new Response(Buffer.from("%PDF-1.4 dare de teste"), { status: 200, headers: { "content-type": "application/pdf" } });
    return html("não encontrado", 404);
  };
  const lerTextoPdf = async () =>
    "DOCUMENTO DE ARRECADACAO DE RECEITAS ESTADUAIS I. Estadual 29.542.854-6 CNPJ 55.981.291/0001-38 Receita 105 Referencia 10/2026 Vencimento 09/11/2026 Valor Total 1.234,56 Nosso Numero 202611090000987 85810000012-1 34560385000-2 26110900009-3 87000000000-4";
  return { buscar, envios, lerTextoPdf };
}

const PEDIDO: PedidoDareTo = {
  inscricaoEstadual: "295428546",
  documento: "55981291000138",
  municipioIbge: "1718204",
  receita: "105",
  periodo: "2026-10",
  vencimento: "2026-11-09",
  valor: "1234.56",
  observacao: "ICMS complementação de alíquota — Simples Nacional — competência 10/2026",
};

describe("DARE-TO: leitura das páginas", () => {
  it("estado GeneXus, campos atuais, valores e endereços", () => {
    const html = formulario({ vDREINSEST: "29.542.854-6", vDRECDGRCT: "105", vDREINFCOM: "A &amp; B" }, {});
    expect(lerGxState(html)?.AJAX_SECURITY_TOKEN).toBe("tok");
    const c = lerCampos(html);
    expect(c).toMatchObject({ vDRECDGRCT: "105", vDRETDCORI: "5", vMUNCDGORI: "1718204", vDREINFCOM: "A & B" });
    expect(c).not.toHaveProperty("BUTTON1");
    expect(c).not.toHaveProperty("GXState");
    expect(normalizarLocal("http://sefaz.to.gov.br:443/dare/servlet/hnetcccnco", `${BASE}/hnetccwkda`)).toBe(`${BASE}/hnetcccnco`);
    expect(valorDoSite("1.234,56")).toBe("1234.56");
    expect(valorBr("1234.5")).toBe("1.234,50");
    expect(numeroDoDare("Nosso Número: 2026.1109.0000.987")).toBe("202611090000987");
    expect(linhaDigitavelDoTexto("85810000012-1 34560385000-2 26110900009-3 87000000000-4")).toBe("85810000012-1 34560385000-2 26110900009-3 87000000000-4");
    expect(enderecoDoRelatorio(`gx.ajax.dispatchCommands([{"popup":{"url":"adrerel02?987,1"}}])`, `${BASE}/hdrewp02`)).toBe(`${BASE}/adrerel02?987,1`);
    expect(enderecoDoRelatorio(`<a href="https://golpe.example.com/x.pdf">x</a>`, `${BASE}/hdrewp02`)).toBeNull();
  });
});

describe("DARE-TO: conferência (sem confirmar)", () => {
  it("consulta o CNPJ, escolhe a inscrição da empresa e confere o total calculado pela SEFAZ", async () => {
    const { buscar, envios } = servidor();
    const p = await conferirDareTo(PEDIDO, buscar);
    expect(p).toEqual({ razaoSocial: "WJE VAREJAO DAS MADEIRAS LTDA", inscricaoEstadual: "29.542.854-6", municipio: "PORTO NACIONAL", total: "1234.56" });
    expect(envios.map((e) => `${e.pagina} ${e.evento}`)).toEqual(["hnetccwkda EENTER.", "hnetcccnco EENTER.", "hdrewp02 EVDRECDGRCT.CLICK.", "hdrewp02 E'CALCULAR'."]);
    // Escolheu a 2ª linha (a inscrição da empresa), não a 1ª
    expect(JSON.parse(envios[1].corpo.get("GXState")!)).toMatchObject({ SFILE_ROW: "0002", _EventRowId: "0002", _EventGridId: "17" });
  });

  it("preenche município, receita 105, vencimento do dia 9, competência, valor e a observação", async () => {
    const { buscar, envios } = servidor();
    await conferirDareTo(PEDIDO, buscar);
    const c = envios.find((e) => e.evento === "E'CALCULAR'.")!.corpo;
    expect(Object.fromEntries(["vDRECDGMUN", "vDRETDCORI", "vDRECDGRCT", "vSUBCDGRCT", "vDREDTAVEN", "vDREREFCHAR", "vDREVLRPRI", "vDREVLRMLT", "vDREVLRJUR", "vDREINFCOM"].map((k) => [k, c.get(k)]))).toEqual({
      vDRECDGMUN: "1718204",
      vDRETDCORI: "5",
      vDRECDGRCT: "105",
      vSUBCDGRCT: "0",
      vDREDTAVEN: "09/11/2026",
      vDREREFCHAR: "10/2026",
      vDREVLRPRI: "1.234,56",
      vDREVLRMLT: "0,00",
      vDREVLRJUR: "0,00",
      vDREINFCOM: "ICMS COMPLEMENTACAO DE ALIQUOTA - SIMPLES NACIONAL - COMPETENCIA 10/2026",
    });
  });

  it("CNPJ não encontrado: mensagem da SEFAZ", async () => {
    const { buscar } = servidor();
    const e = await conferirDareTo({ ...PEDIDO, documento: "11222333000181" }, buscar).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroDareTo);
    expect((e as ErroDareTo).message).toMatch(/não encontrou o contribuinte do CNPJ 11222333000181: Contribuinte não cadastrado!/);
  });

  it("inscrição estadual que não aparece para o CNPJ: para", async () => {
    const { buscar } = servidor();
    await expect(conferirDareTo({ ...PEDIDO, inscricaoEstadual: "290000999" }, buscar)).rejects.toThrow(/inscrição estadual 290000999 não aparece/);
  });

  it("SEFAZ calcula total diferente (multa, juros): não confirma", async () => {
    const { buscar, envios } = servidor({ totalSefaz: "1.300,00" });
    await expect(conferirDareTo(PEDIDO, buscar)).rejects.toThrow(/calculou o DARE em R\$ 1\.300,00, diferente do valor da apuração \(R\$ 1\.234,56\)/);
    expect(envios.some((e) => e.evento === "E'CONFIRM'.")).toBe(false);
  });

  it("receita passou a pedir subcódigo: para sem emitir", async () => {
    const { buscar } = servidor({ subcodigo: true });
    await expect(conferirDareTo(PEDIDO, buscar)).rejects.toThrow(/passou a pedir subcódigo/);
  });
});

describe("DARE-TO: emissão", () => {
  it("confirma, segue para o relatório e confere o PDF", async () => {
    const { buscar, envios, lerTextoPdf } = servidor();
    const r = await emitirDareTo(PEDIDO, { buscar, lerTextoPdf });
    expect(r.numero).toBe("202611090000987");
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.linhaDigitavel).toBe("85810000012-1 34560385000-2 26110900009-3 87000000000-4");
    expect(r.previa.total).toBe("1234.56");
    expect(envios.at(-1)!.evento).toBe("E'CONFIRM'.");
  });

  it("relatório aberto em janela (comando do GeneXus)", async () => {
    const { buscar, lerTextoPdf } = servidor({ confirmar: "popup" });
    expect((await emitirDareTo(PEDIDO, { buscar, lerTextoPdf })).numero).toBe("202611090000987");
  });

  it("SEFAZ recusa no Confirmar: mensagem dela", async () => {
    const { buscar, lerTextoPdf } = servidor({ confirmar: "erro" });
    await expect(emitirDareTo(PEDIDO, { buscar, lerTextoPdf })).rejects.toThrow(/não emitiu o DARE: Data de vencimento inválida/);
  });

  it("PDF com outro valor: não anexa e avisa", async () => {
    const { buscar } = servidor();
    const lerTextoPdf = async () => "I. Estadual 29.542.854-6 Vencimento 09/11/2026 Valor 1.300,00 Nosso Numero 202611090000987";
    await expect(emitirDareTo(PEDIDO, { buscar, lerTextoPdf })).rejects.toThrow(/não confere \(valor R\$ 1\.234,56\)/);
  });
});
