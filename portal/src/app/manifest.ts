import type { MetadataRoute } from "next";

/**
 * Permite instalar o portal na tela inicial do celular ou do computador.
 * No iPhone/iPad, é a instalação que libera as notificações no aparelho.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portal Guarese's ON",
    short_name: "Guarese's ON",
    description: "Documentos, contabilidade e gestão financeira em um só lugar.",
    lang: "pt-BR",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4a2c1d",
    icons: [
      { src: "/marca/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marca/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/marca/icone-mascaravel-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
