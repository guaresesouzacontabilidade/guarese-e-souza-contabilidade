import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
/** Origem das fotos (armazenamento do portal) e, só em teste local, a pasta de fotos de demonstração. */
const origemFotos = (v?: string) => {
  try {
    return v ? new URL(v).origin : "";
  } catch {
    return "";
  }
};
const fotos = [origemFotos(process.env.FOTOS_URL), origemFotos(process.env.VITRINE_DEMO_FOTOS)].filter(Boolean).join(" ");

// Páginas estáticas (guardadas em cache) não recebem nonce: os scripts próprios do Next.js são em linha.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${fotos}`.trim(),
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  dev ? "" : "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  images: {
    loader: "custom",
    loaderFile: "./src/lib/carregador-imagem.ts",
    deviceSizes: [600, 1200],
    imageSizes: [300],
  },
  async headers() {
    return [
      {
        source: "/:caminho*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
