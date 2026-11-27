"use client";

import { useEffect } from "react";
import {
  COOKIE_PRESENCA,
  JANELA_CLIQUE_ARQUIVO_MS,
  PRESENCA_AO_FECHAR_SEGUNDOS,
  PRESENCA_ARQUIVO_SEGUNDOS,
  PRESENCA_SEGUNDOS,
  RENOVAR_PRESENCA_MS,
  atributosPresenca,
} from "@/lib/auth/presenca";

const CANAL = "portal-presenca";

function marcar(segundos: number) {
  document.cookie = `${COOKIE_PRESENCA}=1; ${atributosPresenca(segundos, location.protocol === "https:")}`;
}

/** Link para um arquivo do portal (/api/...) aberto nesta mesma aba (sem nova aba nem download). */
function linkDeArquivoNaMesmaAba(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  try {
    const url = new URL(a.href, location.href);
    return url.origin === location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Mantém o sinal de "portal aberto" desta aba (veja lib/auth/presenca). Ao
 * fechar a aba, o sinal passa a valer só alguns segundos; se ainda houver
 * outra aba do portal aberta, ela recebe o aviso e renova na hora. Quando a aba
 * sai para um arquivo do portal (o PDF de uma nota, por exemplo), o sinal vale
 * alguns minutos, para a pessoa voltar com o Voltar sem perder a sessão.
 */
export function PresencaPortal() {
  useEffect(() => {
    const renovar = () => marcar(PRESENCA_SEGUNDOS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") renovar();
    };
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL);
      canal.onmessage = renovar;
    } catch {
      canal = null;
    }
    let cliqueEmArquivo = 0;
    const aoClicar = (e: MouseEvent) => {
      if (linkDeArquivoNaMesmaAba(e)) cliqueEmArquivo = Date.now();
    };
    const aoFechar = (e: PageTransitionEvent) => {
      // Indo para o cache do navegador (voltar/avançar), a aba continua "viva"
      if (e.persisted) return;
      const foiAoArquivo = Date.now() - cliqueEmArquivo < JANELA_CLIQUE_ARQUIVO_MS;
      marcar(foiAoArquivo ? PRESENCA_ARQUIVO_SEGUNDOS : PRESENCA_AO_FECHAR_SEGUNDOS);
      canal?.postMessage("fechou");
    };

    renovar();
    const intervalo = window.setInterval(renovar, RENOVAR_PRESENCA_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", renovar);
    window.addEventListener("pageshow", renovar);
    window.addEventListener("pagehide", aoFechar);
    document.addEventListener("click", aoClicar);
    return () => {
      document.removeEventListener("click", aoClicar);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", renovar);
      window.removeEventListener("pageshow", renovar);
      window.removeEventListener("pagehide", aoFechar);
      canal?.close();
    };
  }, []);
  return null;
}
