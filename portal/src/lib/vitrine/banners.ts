/**
 * Regras dos banners de campanha sem dependência de servidor (testadas em
 * tests/unit/vitrine-banners.test.ts). Horários no fuso de Tocantins (UTC−3,
 * sem horário de verão), como o resto do portal.
 */

const LINK = /^\/(c\/[a-z0-9-]+|p\/[0-9a-f-]{36}(\/[a-z0-9-]*)?|busca\?q=\S+)$/;

/**
 * Link do banner: aceita o endereço de uma página do site, inteiro
 * ("https://shopluanaaraujo.com.br/c/prata-925") ou só o caminho ("/c/prata-925").
 * Devolve o caminho, null quando vazio ou false quando não é página do site.
 */
export function normalizarLinkBanner(entrada: string): string | null | false {
  const t = entrada.trim();
  if (!t) return null;
  let caminho = t;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      caminho = `${u.pathname}${u.search}`;
    } catch {
      return false;
    }
  }
  caminho = caminho.replace(/\/+$/, "") || "/";
  return LINK.test(caminho) && caminho.length <= 300 ? caminho : false;
}

/** "2026-11-20T08:00" (campo do formulário, hora de Tocantins) → "2026-11-20T08:00:00-03:00"; vazio → null; inválido → false. */
export function horaTocantins(local: string): string | null | false {
  const t = local.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return false;
  const iso = `${t}:00-03:00`;
  return Number.isNaN(Date.parse(iso)) ? false : iso;
}

/** Data gravada → valor do campo do formulário, na hora de Tocantins. */
export function paraCampoLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export type SituacaoBanner = "no_ar" | "agendado" | "encerrado" | "desligado" | "sem_imagem";

export function situacaoBanner(
  b: { ativo: boolean; imagem_computador: string | null; inicio: string | null; fim: string | null },
  agora = Date.now(),
): SituacaoBanner {
  if (!b.ativo) return "desligado";
  if (!b.imagem_computador) return "sem_imagem";
  if (b.fim && Date.parse(b.fim) <= agora) return "encerrado";
  if (b.inicio && Date.parse(b.inicio) > agora) return "agendado";
  return "no_ar";
}

export const ROTULO_SITUACAO: Record<SituacaoBanner, string> = {
  no_ar: "No ar agora",
  agendado: "Agendado",
  encerrado: "Encerrado",
  desligado: "Desligado",
  sem_imagem: "Falta a imagem",
};

/** Tamanhos prontos das imagens do banner (largura em px). */
export const LARGURAS_BANNER = { computador: { p: 960, g: 1920 }, celular: { p: 600, g: 1080 } } as const;
