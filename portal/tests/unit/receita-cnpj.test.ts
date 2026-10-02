import { describe, expect, it, vi } from "vitest";
import { consultarCnpjReceita, formatarCnae, funcaoDoSocio, normalizarRespostaCnpj, regimeSugerido, DadosReceitaSchema } from "@/lib/empresas/receita";

/** Resposta no formato da BrasilAPI/Minha Receita (valores fictícios). */
const RESPOSTA = {
  cnpj: "11222333000181",
  razao_social: "PADARIA PAO DOURADO LTDA",
  nome_fantasia: "PAO DOURADO",
  descricao_situacao_cadastral: "ATIVA",
  data_situacao_cadastral: "2019-03-01",
  descricao_motivo_situacao_cadastral: "SEM MOTIVO",
  data_inicio_atividade: "2019-03-01",
  natureza_juridica: "Sociedade Empresária Limitada",
  porte: "MICRO EMPRESA",
  capital_social: 50000,
  descricao_identificador_matriz_filial: "MATRIZ",
  cnae_fiscal: 1091102,
  cnae_fiscal_descricao: "Fabricação de produtos de padaria e confeitaria com predominância de produção própria",
  cnaes_secundarios: [
    { codigo: 4721102, descricao: "Padaria e confeitaria com predominância de revenda" },
    { codigo: 0, descricao: "" },
  ],
  descricao_tipo_de_logradouro: "AVENIDA",
  logradouro: "PRINCIPAL",
  numero: "200",
  complemento: "",
  bairro: "CENTRO",
  municipio: "PORTO NACIONAL",
  uf: "TO",
  cep: "77500000",
  codigo_municipio_ibge: 1718204,
  ddd_telefone_1: "6333630000",
  ddd_telefone_2: "000000000000",
  email: "CONTATO@PAODOURADO.TEST",
  opcao_pelo_simples: true,
  data_opcao_pelo_simples: "2019-03-01",
  data_exclusao_do_simples: null,
  opcao_pelo_mei: false,
  data_opcao_pelo_mei: null,
  data_exclusao_do_mei: null,
  regime_tributario: [],
  qsa: [
    { nome_socio: "FULANA DE TAL", qualificacao_socio: "Sócio-Administrador", data_entrada_sociedade: "2019-03-01" },
    { nome_socio: "BELTRANO DE TAL", qualificacao_socio: "Sócio", data_entrada_sociedade: "2021-06-10" },
  ],
};

function resposta(status: number, corpo: unknown) {
  return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("dados do CNPJ na Receita", () => {
  it("normaliza a resposta: endereço completo, CNAE formatado, telefone, Simples e sócios", () => {
    const d = normalizarRespostaCnpj(RESPOSTA, "BrasilAPI", new Date("2026-10-02T12:00:00Z"));
    expect(d).toMatchObject({
      cnpj: "11222333000181",
      razaoSocial: "PADARIA PAO DOURADO LTDA",
      nomeFantasia: "PAO DOURADO",
      situacao: "ATIVA",
      motivoSituacao: null,
      abertura: "2019-03-01",
      matriz: true,
      cnaePrincipal: { codigo: "1091-1/02" },
      endereco: { logradouro: "AVENIDA PRINCIPAL", numero: "200", complemento: null, municipio: "PORTO NACIONAL", uf: "TO", cep: "77500000", codigoIbge: "1718204" },
      telefones: ["(63) 3363-0000"],
      email: "contato@paodourado.test",
      simples: { optante: true, desde: "2019-03-01", excluidoEm: null },
      fonte: "Receita Federal — dados abertos do CNPJ (via BrasilAPI)",
      consultadoEm: "2026-10-02T12:00:00.000Z",
    });
    expect(d.cnaesSecundarios).toEqual([{ codigo: "4721-1/02", descricao: "Padaria e confeitaria com predominância de revenda" }]);
    expect(d.socios.map((s) => [s.nome, funcaoDoSocio(s.qualificacao)])).toEqual([
      ["FULANA DE TAL", "socio_administrador"],
      ["BELTRANO DE TAL", "socio"],
    ]);
    // O retrato guardado com a empresa passa na validação
    expect(DadosReceitaSchema.safeParse(d).success).toBe(true);
    expect(() => normalizarRespostaCnpj({ erro: "x" }, "BrasilAPI")).toThrow("formato inesperado");
  });

  it("sugere o regime: MEI, Simples ou a última forma de tributação declarada", () => {
    const base = normalizarRespostaCnpj(RESPOSTA, "BrasilAPI");
    expect(regimeSugerido(base)).toBe("simples_nacional");
    expect(regimeSugerido({ ...base, mei: { optante: true, desde: null, excluidoEm: null } })).toBe("mei");
    const fora = { ...base, simples: { optante: false, desde: null, excluidoEm: null } };
    expect(regimeSugerido({ ...fora, tributacao: { ano: 2024, forma: "LUCRO PRESUMIDO" } })).toBe("lucro_presumido");
    expect(regimeSugerido({ ...fora, tributacao: { ano: 2024, forma: "LUCRO REAL" } })).toBe("lucro_real");
    expect(regimeSugerido({ ...fora, tributacao: null })).toBeNull();
    const ultima = normalizarRespostaCnpj(
      {
        ...RESPOSTA,
        opcao_pelo_simples: false,
        regime_tributario: [
          { ano: 2022, forma_de_tributacao: "LUCRO REAL" },
          { ano: 2024, forma_de_tributacao: "LUCRO PRESUMIDO" },
        ],
      },
      "BrasilAPI",
    );
    expect(ultima.tributacao).toEqual({ ano: 2024, forma: "LUCRO PRESUMIDO" });
    expect(formatarCnae(6920601)).toBe("6920-6/01");
    expect(formatarCnae(111301)).toBe("0111-3/01");
    expect(formatarCnae(null)).toBeNull();
  });

  it("usa a segunda fonte se a primeira falhar e explica quando não dá para consultar", async () => {
    const chamadas: string[] = [];
    const reserva = vi.fn(async (url: string | URL | Request) => {
      chamadas.push(String(url));
      return chamadas.length === 1 ? resposta(503, "fora do ar") : resposta(200, RESPOSTA);
    });
    const d = await consultarCnpjReceita("11.222.333/0001-81", { fetch: reserva as unknown as typeof fetch });
    expect(chamadas).toEqual(["https://brasilapi.com.br/api/cnpj/v1/11222333000181", "https://minhareceita.org/11222333000181"]);
    expect(d.fonte).toContain("Minha Receita");

    const naoEncontrado = vi.fn(async () => resposta(404, { message: "CNPJ não encontrado" }));
    await expect(consultarCnpjReceita("11222333000181", { fetch: naoEncontrado as unknown as typeof fetch })).rejects.toThrow(/não encontrado na base da Receita/);

    const semRede = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(consultarCnpjReceita("11222333000181", { fetch: semRede as unknown as typeof fetch })).rejects.toThrow(/indisponível agora/);

    const nenhuma = vi.fn();
    await expect(consultarCnpjReceita("11222333000180", { fetch: nenhuma as unknown as typeof fetch })).rejects.toThrow("CNPJ inválido");
    expect(nenhuma).not.toHaveBeenCalled();
  });
});
