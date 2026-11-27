import { describe, expect, it } from "vitest";
import { montarAvisoWhatsapp } from "@/lib/notificacoes/envio";

const site = "https://portal.exemplo.com.br";

describe("aviso ao cliente por WhatsApp", () => {
  it("um aviso: empresa, título e link direto", () => {
    expect(montarAvisoWhatsapp([{ titulo: "Novo documento disponível: Guia do DAS", link: "/e/1/documentos/2", empresa: "Padaria" }], site)).toEqual([
      "Padaria",
      "Novo documento disponível: Guia do DAS",
      `${site}/e/1/documentos/2`,
    ]);
  });

  it("vários avisos viram um resumo com link para a lista de avisos", () => {
    const p = montarAvisoWhatsapp(
      [
        { titulo: "Resposta do escritório: Folha", link: "/e/1/mensagens/9", empresa: "Padaria" },
        { titulo: "Novo documento disponível: Guia", link: "/e/1/documentos/2", empresa: "Padaria" },
        { titulo: "Novo documento solicitado: Extrato", link: "/e/1/pendencias", empresa: "Padaria" },
      ],
      site,
    );
    expect(p).toEqual(["Padaria", "3 novidades. A mais recente: Resposta do escritório: Folha", `${site}/notificacoes`]);
  });

  it("avisos de empresas diferentes e textos sem quebras de linha (exigência do WhatsApp)", () => {
    const p = montarAvisoWhatsapp(
      [
        { titulo: "Pendência\nprecisa de    complemento", link: "/x", empresa: "Padaria" },
        { titulo: "Outro", link: null, empresa: "Oficina" },
      ],
      site,
    )!;
    expect(p[0]).toBe("sua empresa");
    expect(p[1]).not.toMatch(/[\n\t]| {4,}/);
  });

  it("nada a avisar quando tudo já foi visto no portal", () => {
    expect(montarAvisoWhatsapp([], site)).toBeNull();
  });

  it("nunca leva para fora do portal", () => {
    expect(montarAvisoWhatsapp([{ titulo: "x", link: "https://golpe.example.com", empresa: "P" }], site)![2]).toBe(`${site}/notificacoes`);
  });
});
