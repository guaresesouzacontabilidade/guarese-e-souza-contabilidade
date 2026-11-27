"use client";

import { registrarAparelho, removerAparelho } from "@/lib/notificacoes/acoes-aparelhos";

/**
 * Notificações no aparelho (Web Push). Funciona no Chrome, Edge, Firefox e
 * Samsung Internet (computador e Android) e no Safari do Mac. No iPhone/iPad
 * (iOS 16.4+), só depois de adicionar o portal à Tela de Início.
 */
export type EstadoAparelho =
  | "carregando"
  | "nao_configurado" // servidor sem as chaves VAPID
  | "sem_suporte"
  | "instalar_iphone"
  | "bloqueado" // permissão negada nas configurações do navegador
  | "inativo"
  | "ativo";

// Quem ativou os avisos neste navegador (outra pessoa que entrar depois não
// herda a ativação: precisa ativar por conta própria).
const CHAVE_USUARIO = "portal-avisos-usuario";

function lerUsuarioLocal() {
  try {
    return localStorage.getItem(CHAVE_USUARIO);
  } catch {
    return null;
  }
}

function gravarUsuarioLocal(id: string | null) {
  try {
    if (id) localStorage.setItem(CHAVE_USUARIO, id);
    else localStorage.removeItem(CHAVE_USUARIO);
  } catch {
    // armazenamento indisponível (janela anônima): só perde a lembrança local
  }
}

export function ehAparelhoApple() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function instaladoNaTelaInicial() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function suportaPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Descrição amigável para a lista de aparelhos ("Chrome no Android"). */
export function descricaoAparelho() {
  const ua = navigator.userAgent;
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Navegador";
  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
        ? "iPad"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "computador";
  return `${navegador} no ${sistema}`;
}

function bytesDaChave(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

async function registroAtual() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

async function inscricaoAtual() {
  const reg = await registroAtual();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enderecoDesteAparelho() {
  if (!suportaPush()) return null;
  return (await inscricaoAtual())?.endpoint ?? null;
}

/** Avisos ativos neste navegador para esta pessoa (verificação rápida, sem rede). */
export function avisosAtivosParaUsuario(usuarioId: string) {
  return typeof Notification !== "undefined" && Notification.permission === "granted" && lerUsuarioLocal() === usuarioId;
}

export async function estadoDoAparelho(usuarioId: string, chavePublica: string | null): Promise<EstadoAparelho> {
  if (!chavePublica) return "nao_configurado";
  if (!suportaPush()) return ehAparelhoApple() && !instaladoNaTelaInicial() ? "instalar_iphone" : "sem_suporte";
  if (Notification.permission === "denied") return "bloqueado";
  if (Notification.permission !== "granted" || lerUsuarioLocal() !== usuarioId) return "inativo";
  return (await inscricaoAtual()) ? "ativo" : "inativo";
}

function dadosDaInscricao(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", descricao: descricaoAparelho() };
}

/** Pede a permissão (precisa ser chamado num clique) e ativa os avisos. */
export async function ativarAvisos(usuarioId: string, chavePublica: string): Promise<{ ok: boolean; mensagem: string }> {
  if (!suportaPush()) return { ok: false, mensagem: "Este navegador não recebe notificações do portal." };
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") {
    return {
      ok: false,
      mensagem:
        permissao === "denied"
          ? "As notificações foram bloqueadas. Libere-as nas configurações do navegador para este site e tente de novo."
          : "Para receber os avisos, toque em “Permitir” quando o navegador perguntar.",
    };
  }
  const reg = (await registroAtual()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const chave = bytesDaChave(chavePublica);
  // Inscrição feita com outra chave (troca de servidor): refaz.
  const chaveAtual = sub?.options.applicationServerKey;
  if (sub && chaveAtual && !iguais(new Uint8Array(chaveAtual), chave)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
  const r = await registrarAparelho(dadosDaInscricao(sub));
  if (!r.ok) return { ok: false, mensagem: r.mensagem ?? "Não foi possível ativar os avisos." };
  gravarUsuarioLocal(usuarioId);
  return { ok: true, mensagem: "Pronto! Este aparelho vai receber os avisos do portal." };
}

function iguais(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Desativa os avisos neste navegador (para esta pessoa). */
export async function desativarAvisos(): Promise<{ ok: boolean; mensagem: string }> {
  const sub = suportaPush() ? await inscricaoAtual() : null;
  if (sub) {
    await removerAparelho({ endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => false);
  }
  gravarUsuarioLocal(null);
  return { ok: true, mensagem: "Este aparelho não vai mais receber os avisos." };
}

/**
 * Ao abrir o portal: se esta pessoa ativou os avisos neste navegador, renova o
 * vínculo com a sessão atual (depois de sair e entrar de novo, volta a receber).
 */
export async function renovarAvisos(usuarioId: string, chavePublica: string | null) {
  if (!chavePublica || !suportaPush() || !avisosAtivosParaUsuario(usuarioId)) return;
  const sub = await inscricaoAtual();
  if (sub) await registrarAparelho(dadosDaInscricao(sub));
}
