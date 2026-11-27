import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { conferir, conferirNoSidago, ErroSidago, lerCampos, lerLista, linksGta, pontosGta, type Buscar, type PedidoGta } from "@/lib/gta/sidago";

/**
 * SIDAGO simulado (só para o teste), com os mesmos endereços do login do site
 * real (application/index/login, charque e autenticacao). O menu e o
 * formulário da GTA são um exemplo: o real só se conhece depois de entrar com
 * o login do produtor, e é isso que o modo conferência mapeia.
 */
const BASE = "https://sidago.agrodefesa.go.gov.br/";
const SENHA = "Senha#123";

const PEDIDO: PedidoGta = {
  origemIe: "109876543",
  origemNome: "Fazenda Exemplo",
  destinoNome: "Frigorífico Exemplo Ltda",
  destinoDocumento: "11222333000181",
  destinoIe: null,
  destinoMunicipio: "Goiânia/GO",
  destinoCodigo: "SIF 1234",
  finalidade: "abate",
  especie: "bovina",
  animais: [
    { sexo: "macho", faixa: "25-36", quantidade: 16 },
    { sexo: "femea", faixa: "36+", quantidade: 4 },
  ],
  totalAnimais: 20,
  transporte: "rodoviario",
  placa: "ABC1D23",
  placaUf: "GO",
  transportadorNome: null,
  transportadorDocumento: null,
  dataSaida: "2026-12-01",
  nfNumero: 15,
  nfSerie: 920,
  nfChave: null,
};

const FORMULARIO = `<html><head><title>SIDAGO - Emitir GTA</title></head><body><form method="post" action="/gta/gravar">
  <label for="finalidade">Finalidade</label><select id="finalidade" name="finalidade"><option value="">Selecione</option><option value="1">ABATE</option><option value="2">ENGORDA</option></select>
  <label for="especie">Espécie</label><select id="especie" name="especie"><option value="1">BOVINOS</option><option value="2">EQUINOS</option></select>
  <label for="dest">Estabelecimento de destino</label><input id="dest" name="destino" type="text">
  <label for="mun">Município</label><input id="mun" name="municipio">
  <table><tr><td>Machos 0 a 12 meses</td><td><input name="m012" type="number"></td></tr>
  <tr><td>Machos 25 a 36 meses</td><td><input name="m2536" type="number"></td></tr>
  <tr><td>Fêmeas acima de 36 meses</td><td><input name="f36" type="number"></td></tr></table>
  <label for="placa">Placa do veículo</label><input id="placa" name="placa">
  <label for="nf">Número da nota fiscal</label><input id="nf" name="nota">
  <label for="tr">Meio de transporte</label><select id="tr" name="transporte"><option>A PÉ</option><option>FLUVIAL</option></select>
  <input type="hidden" name="token" value="x"><input type="submit" value="Gravar">
</form></body></html>`;

function simulador(op: { erroLogin?: string; voltaAoLogin?: boolean; semMenuGta?: boolean } = {}) {
  const chamadas: { metodo: string; caminho: string; corpo: string; cookie: string }[] = [];
  const buscar: Buscar = async (url, init) => {
    const u = new URL(url);
    const caminho = u.pathname.replace(/^\//, "") + u.search;
    const metodo = init?.method ?? "GET";
    const corpo = typeof init?.body === "string" ? init.body : "";
    const cookie = (init?.headers as Record<string, string> | undefined)?.Cookie ?? "";
    chamadas.push({ metodo, caminho, corpo, cookie });
    const html = (t: string, extra: Record<string, string> = {}) => new Response(t, { status: 200, headers: { "Content-Type": "text/html", ...extra } });
    switch (caminho) {
      case "application/index/login":
        return html(`<input id="login"><input id="senha" type="password"><script>nti.login()</script>`, { "Set-Cookie": "PHPSESSID=abc; path=/" });
      case "application/index/charque":
        return new Response(JSON.stringify(["ok", ["hash", "semente-777"], "", ""]));
      case "application/index/autenticacao": {
        const f = new URLSearchParams(corpo);
        const certo = f.get("password") === createHash("md5").update(SENHA).digest("hex") && f.get("seed") === "semente-777" && f.get("login") === "04208285168";
        if (op.erroLogin) return new Response(`['erro','${op.erroLogin}']`);
        return new Response(certo ? `['ok','']` : `['erro','Usuário ou senha inválidos']`);
      }
      case "application/index/index":
        if (op.voltaAoLogin) return html(`<input id="senha"><a onclick="EfetuarLogin()">Entrar</a>`);
        return html(
          op.semMenuGta
            ? `<a href="/propriedade/index">Minhas propriedades</a><a href="/application/index/logout">Sair</a>`
            : `<a href="/gta/index">GTA - Guia de Trânsito Animal</a><a href="/gta/excluir/9">Excluir GTA</a><a href="/application/index/logout">Sair</a><a href="/propriedade/index?id=5">Propriedades</a>`,
        );
      case "gta/index":
        return html(`<h1>Minhas GTAs</h1><a href="/gta/nova">Nova GTA</a><a href="/gta/cancelar/3">Cancelar GTA</a><a href="/gta/imprimir/3">Imprimir GTA</a>`);
      case "gta/nova":
        return html(FORMULARIO);
      default:
        return new Response("não existe", { status: 404 });
    }
  };
  return { buscar, chamadas };
}

describe("robô da GTA no SIDAGO (modo conferência)", () => {
  it("entra como o site (senha em MD5 com a semente), acha o formulário da GTA e mostra o que iria em cada campo", async () => {
    const { buscar, chamadas } = simulador();
    const r = await conferirNoSidago({ login: "04208285168", senha: SENHA }, PEDIDO, buscar);

    expect(r.login).toBe("ok");
    expect(r.formulario?.caminho).toBe("/gta/nova");
    expect(r.formulario?.titulo).toBe("SIDAGO - Emitir GTA");
    const por = Object.fromEntries(r.itens.map((i) => [i.dado, i]));
    expect(por["Finalidade"]).toMatchObject({ campo: "Finalidade", opcao: "ABATE", situacao: "encontrado" });
    expect(por["Espécie"]).toMatchObject({ opcao: "BOVINOS", situacao: "encontrado" });
    expect(por["Destino"]).toMatchObject({ campo: "Estabelecimento de destino", valor: "Frigorífico Exemplo Ltda" });
    expect(por["Machos de 25 a 36 meses"]).toMatchObject({ campo: "Machos 25 a 36 meses", valor: "16" });
    expect(por["Fêmeas acima de 36 meses"]).toMatchObject({ campo: "Fêmeas acima de 36 meses", valor: "4" });
    expect(por["Placa"]).toMatchObject({ campo: "Placa do veículo", valor: "ABC1D23 (GO)" });
    expect(por["Nota fiscal"]).toMatchObject({ campo: "Número da nota fiscal", valor: "15 série 920" });
    expect(por["Transporte"]).toMatchObject({ situacao: "opcao_nao_encontrada" });
    expect(por["Data de saída"]).toMatchObject({ situacao: "campo_nao_encontrado", valor: "01/12/2026" });

    // Só o login é enviado; nenhuma página de excluir, cancelar, imprimir ou sair é aberta
    const posts = chamadas.filter((c) => c.metodo !== "GET").map((c) => c.caminho);
    expect(posts).toEqual(["application/index/charque", "application/index/autenticacao"]);
    expect(chamadas.map((c) => c.caminho).join(" ")).not.toMatch(/excluir|cancelar|imprimir|logout|gravar/);
    // A sessão (cookie) segue nas páginas depois do login, e a senha nunca vai no resultado
    expect(chamadas.find((c) => c.caminho === "gta/nova")?.cookie).toContain("PHPSESSID=abc");
    expect(JSON.stringify(r)).not.toContain(SENHA);
    expect(r.links).toEqual([{ texto: "Propriedades", caminho: "/propriedade/index" }]);
  });

  it("explica o motivo quando o SIDAGO recusa o login", async () => {
    const erro = await conferirNoSidago({ login: "04208285168", senha: SENHA }, PEDIDO, simulador({ erroLogin: "mudarSenha" }).buscar).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroSidago);
    expect(erro.etapa).toBe("login");
    expect(erro.message).toMatch(/troca da senha/);

    const senhaErrada = await conferirNoSidago({ login: "04208285168", senha: "outra" }, PEDIDO, simulador().buscar).catch((e) => e);
    expect(senhaErrada.message).toMatch(/recusou o login: Usuário ou senha inválidos/);

    const voltou = await conferirNoSidago({ login: "04208285168", senha: SENHA }, PEDIDO, simulador({ voltaAoLogin: true }).buscar).catch((e) => e);
    expect(voltou.message).toMatch(/voltou para a tela de entrada/);
  });

  it("sem o menu da GTA, guarda os links da página inicial para ajustar o robô", async () => {
    const r = await conferirNoSidago({ login: "04208285168", senha: SENHA }, PEDIDO, simulador({ semMenuGta: true }).buscar);
    expect(r.formulario).toBeNull();
    expect(r.itens).toEqual([]);
    expect(r.links).toEqual([{ texto: "Minhas propriedades", caminho: "/propriedade/index" }]);
  });

  it("sem resposta do SIDAGO, avisa sem travar", async () => {
    const erro = await conferirNoSidago({ login: "x", senha: "y" }, PEDIDO, async () => {
      throw new Error("rede");
    }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroSidago);
    expect(erro.etapa).toBe("conexao");
  });

  it("lê as respostas, os links e os campos", () => {
    expect(lerLista("['erro','usuarioBloqueado']")).toEqual(["erro", "usuarioBloqueado"]);
    expect(lerLista('["ok",["a","b"],"",""]')).toEqual(["ok", ["a", "b"], "", ""]);
    expect(lerLista("<html>")).toBeNull();
    expect(linksGta(`<a href="${BASE}gta/lista">GTA</a><a href="https://outro.site/gta">GTA</a><a href="javascript:gta()">GTA</a>`)).toEqual([{ texto: "GTA", caminho: "/gta/lista" }]);
    const campos = lerCampos(FORMULARIO);
    expect(campos.map((c) => c.nome)).toEqual(["finalidade", "especie", "destino", "municipio", "m012", "m2536", "f36", "placa", "nota", "transporte"]);
    expect(pontosGta(campos)).toBeGreaterThanOrEqual(6);
    expect(conferir(campos, { ...PEDIDO, finalidade: "leilao" }).find((i) => i.dado === "Finalidade")?.situacao).toBe("opcao_nao_encontrada");
  });
});
