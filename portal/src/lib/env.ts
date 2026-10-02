/**
 * Variáveis de ambiente.
 * As variáveis NEXT_PUBLIC_* chegam ao navegador; todas as demais ficam somente
 * no servidor (nunca exponha chaves secretas com o prefixo NEXT_PUBLIC_).
 */

function obrigatoria(nome: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${nome} não configurada. Consulte o arquivo .env.example e docs/CONFIGURACAO.md.`,
    );
  }
  return valor;
}

export const envPublico = {
  supabaseUrl: () => obrigatoria("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseChavePublica: () =>
    obrigatoria(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  siteUrl: () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  ambiente: (): "producao" | "demonstracao" | "desenvolvimento" => {
    const v = process.env.NEXT_PUBLIC_AMBIENTE;
    if (v === "producao" || v === "demonstracao") return v;
    return "desenvolvimento";
  },
};
