"use client";

import { useEffect } from "react";
import { COOKIE_PRESENCA, PRESENCA_AO_FECHAR_SEGUNDOS, PRESENCA_SEGUNDOS, RENOVAR_PRESENCA_MS, atributosPresenca } from "@/lib/auth/presenca";

const CANAL = "portal-presenca";

function marcar(segundos: number) {
  document.cookie = `${COOKIE_PRESENCA}=1; ${atributosPresenca(segundos, location.protocol === "https:")}`;
}

/**
 * Mantém o sinal de "portal aberto" desta aba (veja lib/auth/presenca). Ao
 * fechar a aba, o sinal passa a valer só alguns segundos; se ainda houver
 * outra aba do portal aberta, ela recebe o aviso e renova na hora.
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
    const aoFechar = (e: PageTransitionEvent) => {
      // Indo para o cache do navegador (voltar/avançar), a aba continua "viva"
      if (e.persisted) return;
      marcar(PRESENCA_AO_FECHAR_SEGUNDOS);
      canal?.postMessage("fechou");
    };

    renovar();
    const intervalo = window.setInterval(renovar, RENOVAR_PRESENCA_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", renovar);
    window.addEventListener("pageshow", renovar);
    window.addEventListener("pagehide", aoFechar);
    return () => {
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
