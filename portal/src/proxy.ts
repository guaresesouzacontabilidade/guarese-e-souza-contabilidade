import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (antigo middleware):
 *  1. renova a sessão do Supabase e grava os cookies atualizados;
 *  2. protege as rotas privadas (sem sessão → /login; 2FA pendente → /mfa);
 *  3. aplica cabeçalhos de segurança e a política de conteúdo (CSP) com nonce.
 * A autorização efetiva acontece no servidor (ações) e no banco (RLS).
 */

const ROTAS_PUBLICAS = [
  "/login",
  "/recuperar-senha",
  "/auth/",
  "/privacidade",
  "/termos",
  "/api/cron/",
  "/api/saude",
];

const ROTAS_SEM_EXIGENCIA_MFA = ["/mfa", "/auth/sair", "/auth/confirm", "/definir-senha", "/redefinir-senha"];

function rotaPublica(caminho: string) {
  return caminho === "/" ? false : ROTAS_PUBLICAS.some((r) => caminho === r || caminho.startsWith(r));
}

function montarCsp(nonce: string) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let supabaseWs = "";
  try {
    const u = new URL(supabase);
    supabaseWs = `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
  } catch {
    // URL ausente em build sem variáveis
  }
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Estilos inline são usados por componentes acessíveis e gráficos (atributos style).
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${supabaseWs}`,
    `frame-src 'self' blob: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    dev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function proxy(request: NextRequest) {
  const caminho = request.nextUrl.pathname;
  const ehApi = caminho.startsWith("/api/");
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = montarCsp(nonce);

  const cabecalhosRequisicao = new Headers(request.headers);
  cabecalhosRequisicao.set("x-nonce", nonce);
  cabecalhosRequisicao.set("x-caminho", caminho);

  let resposta = NextResponse.next({ request: { headers: cabecalhosRequisicao } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let logado = false;
  let precisaMfa = false;

  if (url && chave) {
    const supabase = createServerClient(url, chave, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesParaGravar, cabecalhos) {
          for (const { name, value } of cookiesParaGravar) request.cookies.set(name, value);
          resposta = NextResponse.next({ request: { headers: cabecalhosRequisicao } });
          for (const { name, value, options } of cookiesParaGravar) resposta.cookies.set(name, value, options);
          if (cabecalhos) {
            for (const [k, v] of Object.entries(cabecalhos)) resposta.headers.set(k, v);
          }
        },
      },
    });

    // Valida o token (e renova a sessão quando necessário).
    const { data } = await supabase.auth.getClaims();
    logado = Boolean(data?.claims?.sub);
    if (logado) {
      const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      precisaMfa = nivel?.nextLevel === "aal2" && nivel.currentLevel !== "aal2";
    }
  }

  const redirecionar = (destino: string, params?: Record<string, string>) => {
    const alvo = request.nextUrl.clone();
    alvo.pathname = destino;
    alvo.search = "";
    for (const [k, v] of Object.entries(params ?? {})) alvo.searchParams.set(k, v);
    const r = NextResponse.redirect(alvo);
    // preserva cookies de sessão renovados
    for (const c of resposta.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!ehApi) {
    if (!logado && !rotaPublica(caminho)) {
      return aplicarCabecalhos(
        redirecionar("/login", caminho !== "/" ? { proximo: caminho + request.nextUrl.search } : undefined),
        csp,
      );
    }
    if (logado && precisaMfa && !ROTAS_SEM_EXIGENCIA_MFA.some((r) => caminho.startsWith(r)) && !rotaPublica(caminho)) {
      return aplicarCabecalhos(redirecionar("/mfa", { proximo: caminho }), csp);
    }
    if (logado && !precisaMfa && (caminho === "/login" || caminho === "/")) {
      return aplicarCabecalhos(redirecionar("/painel"), csp);
    }
  }

  return aplicarCabecalhos(resposta, ehApi ? null : csp);
}

function aplicarCabecalhos(resposta: NextResponse, csp: string | null) {
  if (csp) resposta.headers.set("Content-Security-Policy", csp);
  resposta.headers.set("X-Content-Type-Options", "nosniff");
  resposta.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  resposta.headers.set("X-Frame-Options", "DENY");
  resposta.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  if (process.env.NODE_ENV === "production") {
    resposta.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return resposta;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|marca/|manifest.webmanifest|sw.js|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
