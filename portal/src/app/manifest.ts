import type { MetadataRoute } from "next";
import { BORDAO_SISTEMA, NOME_SISTEMA } from "@/lib/marca/sistema";

/**
 * Permite instalar o portal na tela inicial do celular ou do computador.
 * No iPhone/iPad, é a instalação que libera as notificações no aparelho.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: NOME_SISTEMA,
    short_name: NOME_SISTEMA,
    description: BORDAO_SISTEMA,
    lang: "pt-BR",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f4",
    theme_color: "#07461f",
    icons: [
      { src: "/marca/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marca/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/marca/icone-mascaravel-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
