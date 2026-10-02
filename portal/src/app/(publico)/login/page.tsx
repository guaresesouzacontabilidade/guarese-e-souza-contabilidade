import type { Metadata } from "next";
import { ShieldCheck, FileUp, ListChecks, LineChart } from "lucide-react";
import { Logo } from "@/components/marca/logo";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar" };

const AVISOS: Record<string, string> = {
  inativo: "Seu acesso está desativado. Fale com o escritório.",
  sessao: "Sua sessão foi encerrada. Entre novamente.",
  saiu: "Você saiu do portal com segurança.",
  link: "O link utilizado é inválido ou expirou. Solicite um novo.",
  senha: "Senha definida com sucesso. Entre com sua nova senha.",
};

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const proximo = typeof sp.proximo === "string" ? sp.proximo : undefined;
  const motivo = typeof sp.motivo === "string" ? sp.motivo : typeof sp.erro === "string" ? sp.erro : null;
  const esc = await obterEscritorioPublico();

  return (
    <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg md:grid-cols-2">
      <section className="flex flex-col justify-between gap-8 bg-bege p-6 sm:p-10 dark:bg-muted">
        <div className="space-y-6">
          <Logo logoUrl={esc.logoUrl} versao="vertical" className={esc.logoUrl ? "h-14" : "h-24"} />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{esc.nome_sistema}</h1>
            <p className="text-sm text-muted-foreground">{esc.descricao_sistema}</p>
          </div>
          <p className="text-base leading-relaxed text-foreground">{esc.mensagem_login}</p>
        </div>
        <ul className="grid gap-3 text-sm text-foreground/90">
          <li className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" /> Envio de documentos pelo computador ou celular
          </li>
          <li className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" /> Pendências do mês com prazos claros
          </li>
          <li className="flex items-center gap-2">
            <LineChart className="size-4 text-primary" /> Relatórios e saúde financeira da empresa
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Acesso protegido e dados separados por empresa
          </li>
        </ul>
      </section>
      <section className="flex flex-col justify-center p-6 sm:p-10">
        <h2 className="mb-1 text-xl font-semibold">Acesse sua conta</h2>
        <p className="mb-6 text-sm text-muted-foreground">Use o e-mail cadastrado pelo escritório.</p>
        <FormularioLogin proximo={proximo} aviso={motivo ? AVISOS[motivo] ?? null : null} />
      </section>
    </div>
  );
}
