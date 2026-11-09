import { describe, expect, it } from "vitest";
import {
  ErroDareTo,
  emitirDareTo,
  linhaDigitavelDoTexto,
  mascararLogin,
  numeroDoDare,
  papelDoCampo,
  testarDareTo,
  valorBr,
  type Buscar,
  type PedidoDareTo,
} from "@/lib/dare-to/robo";
import { lerFormularios } from "@/lib/dare-to/html";

/**
 * Simulação do TOauth e do sistema de DARE (só para o teste): as telas seguem o
 * padrão de um sistema Rails com entrada pelo login do governo do Tocantins.
 */
const DARE = "https://dare.sefaz.to.gov.br";
const AUTH = "https://toauth.ati.to.gov.br";

interface Opcoes {
  /** Página do formulário de emissão (HTML). */
  formulario?: string;
  /** Pedir a autorização do aplicativo depois do login. */
  autorizar?: boolean;
  /** Redirecionar o authorize para fora do governo. */
  desvio?: string;
  textoPdf?: string;
}

const FORM_PADRAO = `
<html><head><title>Emitir DARE</title></head><body>
<form action="/dares" method="post">
  <input type="hidden" name="authenticity_token" value="tok-form">
  <label for="dare_ie">Inscrição Estadual *</label><input id="dare_ie" name="dare[inscricao_estadual]" required>
  <label for="dare_receita">Receita</label>
  <select id="dare_receita" name="dare[receita_id]" required><option value="">Selecione</option><option value="3">100 - ICMS NORMAL</option><option value="7">105 - ICMS COMPLEMENTACAO DE ALIQUOTA</option></select>
  <label for="dare_ref">Referência (MM/AAAA)</label><input id="dare_ref" name="dare[referencia]" required>
  <label for="dare_venc">Data de vencimento</label><input id="dare_venc" name="dare[vencimento]" required>
  <label for="dare_valor">Valor principal</label><input id="dare_valor" name="dare[valor]" required>
  <label for="dare_obs">Informações complementares</label><textarea id="dare_obs" name="dare[informacoes]" maxlength="60"></textarea>
  <input type="submit" name="commit" value="Gerar DARE">
</form></body></html>`;

function servidor(op: Opcoes = {}) {
  const envios: { url: string; corpo: URLSearchParams }[] = [];
  const buscar: Buscar = async (url, init) => {
    const u = new URL(url);
    const metodo = init?.method ?? "GET";
    const cookies = String((init?.headers as Record<string, string>)?.Cookie ?? "");
    const corpo = new URLSearchParams(String(init?.body ?? ""));
    if (metodo === "POST") envios.push({ url, corpo });
    const html = (b: string, status = 200, extra: Record<string, string> = {}) => new Response(b, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });
    const ir = (local: string, extra: Record<string, string> = {}) => new Response(null, { status: 302, headers: { location: local, ...extra } });
    const rota = `${metodo} ${u.origin}${u.pathname}`;

    switch (rota) {
      case `GET ${DARE}/users/sign_in`:
        return ir(`${AUTH}/oauth/authorize?client_id=abc&redirect_uri=${encodeURIComponent(`${DARE}/toauth`)}&response_type=code`);
      case `GET ${AUTH}/oauth/authorize`:
        if (op.desvio) return ir(op.desvio);
        if (!cookies.includes("toauth_sess=ok")) return ir(`${AUTH}/users/sign_in?return_to=%2Foauth%2Fauthorize`);
        if (op.autorizar && !cookies.includes("autorizado=1"))
          return html(`<form action="/oauth/authorize" method="post"><input type="hidden" name="client_id" value="abc"><input type="submit" name="commit" value="Autorizar"></form>`);
        return ir(`${DARE}/toauth?code=c0d1g0`);
      case `POST ${AUTH}/oauth/authorize`:
        return ir(`${DARE}/toauth?code=c0d1g0`, { "set-cookie": "autorizado=1; path=/" });
      case `GET ${AUTH}/users/sign_in`:
        return html(
          `<form action="/users/sign_in" method="post"><input type="hidden" name="authenticity_token" value="tok-login"><input name="user[login]" placeholder="E-mail ou CPF" type="text"><input name="user[password]" type="password"><input type="submit" name="commit" value="Entrar"></form>`,
          200,
          { "set-cookie": "_toauth=pre; path=/; HttpOnly" },
        );
      case `POST ${AUTH}/users/sign_in`:
        if (corpo.get("user[login]") === "12345678901" && corpo.get("user[password]") === "senha-certa" && corpo.get("authenticity_token") === "tok-login") {
          return ir(`${AUTH}/oauth/authorize`, { "set-cookie": "toauth_sess=ok; path=/" });
        }
        return html(`<div class="alert alert-danger">Login ou senha inválidos.</div><form action="/users/sign_in" method="post"><input name="user[login]"><input name="user[password]" type="password"></form>`);
      case `GET ${DARE}/toauth`:
        return u.searchParams.get("code") === "c0d1g0" ? ir(`${DARE}/`, { "set-cookie": "_dare_session=s1; path=/; secure" }) : html("código inválido", 401);
      case `GET ${DARE}/`:
        if (!cookies.includes("_dare_session=s1")) return ir(`${DARE}/users/sign_in`);
        return html(`<title>DARE</title><a href="/dares">Meus DAREs</a> <a href="/dares/new">Emitir DARE</a> <a href="/users/sign_out">Sair</a>`);
      case `GET ${DARE}/dares/new`:
        return html(op.formulario ?? FORM_PADRAO);
      case `POST ${DARE}/dares`:
        return ir(`${DARE}/dares/987`);
      case `GET ${DARE}/dares/987`:
        return html(`<h1>DARE gerado</h1><p>Nosso Número: 2026.1109.0000.987</p><a href="/dares/987.pdf">Imprimir</a>`);
      case `GET ${DARE}/dares/987.pdf`:
        return new Response(Buffer.from("%PDF-1.4 dare de teste"), { status: 200, headers: { "content-type": "application/pdf" } });
      default:
        return html("não encontrado", 404);
    }
  };
  const lerTextoPdf = async () =>
    op.textoPdf ??
    "DOCUMENTO DE ARRECADACAO DE RECEITAS ESTADUAIS Inscricao Estadual 29.123.456-7 Receita 105 Referencia 10/2026 Vencimento 09/11/2026 Valor 200,00 Nosso Numero 202611090000987 85810000002-1 00000385000-2 26110900009-3 87000000000-4";
  return { buscar, envios, lerTextoPdf };
}

const CRED = { login: "123.456.789-01", senha: "senha-certa" };
const PEDIDO: PedidoDareTo = {
  inscricaoEstadual: "291234567",
  documento: "11222333000181",
  receita: "105",
  periodo: "2026-10",
  vencimento: "2026-11-09",
  valor: "200.00",
  informacao: "Complementação de alíquota — Simples Nacional — referência 10/2026",
};

describe("DARE-TO: leitura das telas", () => {
  it("reconhece os campos pelos rótulos", () => {
    const [f] = lerFormularios(FORM_PADRAO, `${DARE}/dares/new`);
    expect(f.acao).toBe(`${DARE}/dares`);
    const papeis = Object.fromEntries(f.campos.map((c) => [c.nome, papelDoCampo(c)]));
    expect(papeis).toMatchObject({
      "dare[inscricao_estadual]": "inscricao",
      "dare[receita_id]": "receita",
      "dare[referencia]": "referencia",
      "dare[vencimento]": "vencimento",
      "dare[valor]": "valor",
      "dare[informacoes]": "informacao",
      authenticity_token: null,
    });
    // "Valor dos juros", "Valor total" e subcódigo não são o valor principal nem a receita
    expect(papelDoCampo({ nome: "x", tipo: "text", id: null, rotulo: "Valor dos juros", valor: "", obrigatorio: false, desabilitado: false, maxLength: null, opcoes: [] })).toBeNull();
    expect(papelDoCampo({ nome: "x", tipo: "text", id: null, rotulo: "Valor total", valor: "", obrigatorio: false, desabilitado: false, maxLength: null, opcoes: [] })).toBeNull();
    expect(papelDoCampo({ nome: "x", tipo: "select", id: null, rotulo: "Subcódigo da receita", valor: "", obrigatorio: true, desabilitado: false, maxLength: null, opcoes: [] })).toBeNull();
    expect(papelDoCampo({ nome: "x", tipo: "text", id: null, rotulo: "Mês/Ano de referência", valor: "", obrigatorio: true, desabilitado: false, maxLength: null, opcoes: [] })).toBe("referencia");
  });

  it("número do DARE, linha digitável, valor e login mascarado", () => {
    expect(numeroDoDare("Nosso Número: 2026.1109.0000.987")).toBe("202611090000987");
    expect(numeroDoDare("Sem número aqui")).toBeNull();
    expect(linhaDigitavelDoTexto("85810000002-1 00000385000-2 26110900009-3 87000000000-4")).toBe("85810000002-1 00000385000-2 26110900009-3 87000000000-4");
    expect(valorBr("1234.5")).toBe("1.234,50");
    expect(mascararLogin("123.456.789-01")).toBe("***.456.789-**");
    expect(mascararLogin("joao@escritorio.com.br")).toBe("jo***@escritorio.com.br");
  });
});

describe("DARE-TO: teste de conexão (sem emitir)", () => {
  it("entra pelo TOauth, acha o formulário e guarda só a estrutura", async () => {
    const { buscar, envios } = servidor();
    const r = await testarDareTo(CRED, buscar);
    expect(r.ok).toBe(true);
    expect(r.mapeamento.escolhido?.caminho).toBe("/dares/new");
    expect(r.mapeamento.escolhido?.papeis).toMatchObject({ receita: "dare[receita_id]", valor: "dare[valor]" });
    // Nada foi enviado ao DARE (só o login no TOauth)
    expect(envios.map((e) => new URL(e.url).host)).toEqual(["toauth.ati.to.gov.br"]);
    const guardado = JSON.stringify(r.mapeamento);
    expect(guardado).not.toContain("senha-certa");
    expect(guardado).not.toContain("tok-form");
    expect(guardado).not.toContain("c0d1g0");
  });

  it("aceita a autorização do aplicativo pedida no primeiro acesso", async () => {
    const { buscar } = servidor({ autorizar: true });
    expect((await testarDareTo(CRED, buscar)).ok).toBe(true);
  });

  it("senha errada: mensagem do governo do Tocantins", async () => {
    const { buscar } = servidor();
    await expect(testarDareTo({ login: CRED.login, senha: "errada" }, buscar)).rejects.toThrow(/não aceitou o login: Login ou senha inválidos/);
  });

  it("redirecionamento para fora do governo: para por segurança e não manda a senha", async () => {
    const { buscar, envios } = servidor({ desvio: "https://golpe.example.com/oauth" });
    const e = await testarDareTo(CRED, buscar).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroDareTo);
    expect((e as ErroDareTo).etapa).toBe("conexao");
    expect(envios).toHaveLength(0);
  });

  it("campo obrigatório desconhecido: não fica pronto e diz qual é", async () => {
    const form = FORM_PADRAO.replace(
      "<input type=\"submit\"",
      '<label for="sub">Subcódigo</label><select id="sub" name="dare[subcodigo]" required><option value="">Selecione</option><option value="1">1</option></select><input type="submit"',
    );
    const { buscar } = servidor({ formulario: form });
    const r = await testarDareTo(CRED, buscar);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("Subcódigo");
  });
});

describe("DARE-TO: emissão", () => {
  it("preenche receita 105, mês, vencimento do dia 9 e valor; baixa e confere o PDF", async () => {
    const { buscar, envios, lerTextoPdf } = servidor();
    const r = await emitirDareTo(CRED, PEDIDO, { buscar, lerTextoPdf });
    expect(r.numero).toBe("202611090000987");
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.linhaDigitavel).toBe("85810000002-1 00000385000-2 26110900009-3 87000000000-4");
    const envio = envios.find((e) => e.url === `${DARE}/dares`)!.corpo;
    expect(envio.get("dare[inscricao_estadual]")).toBe("291234567");
    expect(envio.get("dare[receita_id]")).toBe("7");
    expect(envio.get("dare[referencia]")).toBe("10/2026");
    expect(envio.get("dare[vencimento]")).toBe("09/11/2026");
    expect(envio.get("dare[valor]")).toBe("200,00");
    // Sem acento, travessão vira hífen e respeita o tamanho do campo (60)
    expect(envio.get("dare[informacoes]")).toMatch(/^COMPLEMENTACAO DE ALIQUOTA - SIMPLES NACIONAL - REFERENCIA/);
    expect(envio.get("dare[informacoes]")!.length).toBeLessThanOrEqual(60);
    expect(envio.get("authenticity_token")).toBe("tok-form");
    expect(envio.get("commit")).toBe("Gerar DARE");
  });

  it("receita que não está na lista: não emite", async () => {
    const { buscar, envios, lerTextoPdf } = servidor();
    await expect(emitirDareTo(CRED, { ...PEDIDO, receita: "999" }, { buscar, lerTextoPdf })).rejects.toThrow(/não oferece a receita 999/);
    expect(envios.some((e) => e.url === `${DARE}/dares`)).toBe(false);
  });

  it("PDF com outro valor: não anexa e avisa", async () => {
    const { buscar } = servidor();
    const lerTextoPdf = async () => "Inscricao 291234567 Vencimento 09/11/2026 Valor 210,00 Nosso Numero 202611090000987";
    await expect(emitirDareTo(CRED, PEDIDO, { buscar, lerTextoPdf })).rejects.toThrow(/não confere \(valor R\$ 200,00\)/);
  });
});
