/**
 * "Portal aberto": enquanto houver uma aba do portal aberta, ela renova este
 * cookie curto. Fechadas todas as abas, ele expira em segundos e o servidor
 * (proxy) encerra a sessão antes de mostrar qualquer página — quem abrir o
 * portal de novo precisa entrar. Recarregar a página, abrir outra aba ou voltar
 * ao aplicativo no celular não desconecta.
 */
export const COOKIE_PRESENCA = "portal_aberto";
/** Validade enquanto a aba está aberta (renovada a cada 30 s e ao voltar à aba). */
export const PRESENCA_SEGUNDOS = 180;
/** Validade depois que a aba fecha (as outras abas abertas renovam na hora). */
export const PRESENCA_AO_FECHAR_SEGUNDOS = 5;
export const RENOVAR_PRESENCA_MS = 30_000;

/** Atributos do cookie (sem HttpOnly: é a própria aba que o renova). */
export function atributosPresenca(segundos: number, seguro: boolean) {
  return `Max-Age=${segundos}; Path=/; SameSite=Lax${seguro ? "; Secure" : ""}`;
}
