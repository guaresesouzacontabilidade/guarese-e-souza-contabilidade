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
  // Fontes usadas na geração de PDFs.
  outputFileTracingIncludes: {
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
