import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHost: { protocol: "http" | "https"; hostname: string; port: string } | null = null;
try {
  if (supabaseUrl) {
    const u = new URL(supabaseUrl);
    supabaseHost = { protocol: u.protocol.replace(":", "") as "http" | "https", hostname: u.hostname, port: u.port };
  }
} catch {
  supabaseHost = null;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  // Bibliotecas de servidor carregadas pelo Node (PDF, planilhas, OCR, e-mail).
  serverExternalPackages: ["pdfmake", "exceljs", "tesseract.js", "nodemailer", "unpdf", "@napi-rs/canvas"],
  // Fontes usadas na geração de PDFs e, para o OCR, o código da "worker
  // thread" e o núcleo WebAssembly do Tesseract — carregados dinamicamente,
  // a análise automática não os encontra. O OCR roda nas rotas da fila e
  // também após as ações de envio (after()), por isso vale para todas.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/src/**/*.js",
      "./node_modules/tesseract.js-core/package.json",
      "./node_modules/tesseract.js-core/tesseract-core-*lstm.js",
      "./node_modules/tesseract.js-core/tesseract-core-*lstm.wasm",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/is-url/**/*",
    ],
    "/api/relatorios/**": ["./node_modules/pdfmake/fonts/Roboto/*.ttf"],
    "/api/financeiro/**": ["./node_modules/pdfmake/fonts/Roboto/*.ttf"],
  },
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: supabaseHost.protocol, hostname: supabaseHost.hostname, port: supabaseHost.port, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
