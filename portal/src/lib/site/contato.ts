/**
 * Formulário de contato do site institucional (onguaresescontabilidade.com.br):
 * validação dos campos, origens aceitas e limite de envios por endereço.
 * A mensagem só vai para o e-mail do escritório; nada é guardado no banco.
 */

export interface ContatoSite {
  nome: string;
  email: string;
  telefone: string;
  empresa: string;
  assunto: string;
  mensagem: string;
}

export type ResultadoValidacao =
  | { ok: true; dados: ContatoSite }
  /** Robô (campo isca preenchido ou envio rápido demais): responde "ok" sem enviar. */
  | { ok: false; robo: true }
  | { ok: false; robo?: false; mensagem: string };

export const ASSUNTOS_CONTATO = ["Quero ser cliente", "Abrir uma empresa", "Trocar de contador", "Outro assunto"] as const;

/** Tempo mínimo (ms) entre abrir a página e enviar: menos que isso é robô. */
export const TEMPO_MINIMO_MS = 2500;

const ORIGENS_FIXAS = new Set(["https://onguaresescontabilidade.com.br", "https://www.onguaresescontabilidade.com.br"]);
/** Endereço de teste do site na Vercel e as prévias do mesmo projeto (equipe portal-on-guareses). */
const ORIGEM_TESTE = /^https:\/\/site-on-guareses(-[a-z0-9]+-portal-on-guareses)?\.vercel\.app$/;

export function origemPermitida(origem: string | null, producao = process.env.NODE_ENV === "production"): boolean {
  if (!origem) return false;
  if (ORIGENS_FIXAS.has(origem) || ORIGEM_TESTE.test(origem)) return true;
  return !producao && /^http:\/\/localhost:\d+$/.test(origem);
}

const limpar = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
const umaLinha = (v: unknown, max: number) => limpar(v, max).replace(/\s+/g, " ");

export function validarContato(corpo: unknown): ResultadoValidacao {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  if (limpar(c.site, 200)) return { ok: false, robo: true };
  const tempo = Number(c.tempo);
  if (!Number.isFinite(tempo) || tempo < TEMPO_MINIMO_MS) return { ok: false, robo: true };

  const nome = umaLinha(c.nome, 120);
  const email = umaLinha(c.email, 200).toLowerCase();
  const telefone = umaLinha(c.telefone, 30);
  const empresa = umaLinha(c.empresa, 160);
  const assuntoBruto = umaLinha(c.assunto, 80);
  const assunto = (ASSUNTOS_CONTATO as readonly string[]).includes(assuntoBruto) ? assuntoBruto : "Outro assunto";
  const mensagem = limpar(c.mensagem, 3000);

  if (nome.length < 2) return { ok: false, mensagem: "Informe o seu nome." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, mensagem: "Informe um e-mail válido para a resposta." };
  if (telefone && !/^[\d\s()+.-]{8,30}$/.test(telefone)) return { ok: false, mensagem: "Confira o telefone (só números, espaços, parênteses e traço)." };
  if (mensagem.length < 5) return { ok: false, mensagem: "Escreva a sua mensagem." };
  if (c.consentimento !== true) return { ok: false, mensagem: "É preciso concordar com o uso dos dados para responder ao contato." };
  return { ok: true, dados: { nome, email, telefone, empresa, assunto, mensagem } };
}

/** Limite simples por endereço (por instância do servidor): no máximo `maximo` envios na janela. */
export function criarLimitador(maximo = 5, janelaMs = 15 * 60_000) {
  const registros = new Map<string, number[]>();
  return (chave: string, agora = Date.now()): boolean => {
    const recentes = (registros.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    if (recentes.length >= maximo) {
      registros.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    registros.set(chave, recentes);
    if (registros.size > 5000) registros.delete(registros.keys().next().value as string);
    return true;
  };
}
