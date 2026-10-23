import type { Metadata } from "next";
import { ShieldCheck, FileUp, ListChecks, LineChart } from "lucide-react";
import { Logo } from "@/components/marca/logo";
import { IlustracaoEntrada } from "@/components/marca/ilustracao-entrada";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar" };

const AVISOS: Record<string, string> = {
  inativo: "Seu acesso está desativado. Fale com o escritório.",
  sessao: "Sua sessão foi encerrada. Entre novamente.",
  saiu: "Você saiu do portal com segurança.",
  fechado: "Por segurança, a sessão foi encerrada porque o portal foi fechado. Entre novamente.",
  link: "O link utilizado é inválido ou passou do prazo (os links valem 1 hora). Use “Esqueci minha senha” ou peça ao escritório um novo link de acesso.",
  senha: "Senha definida com sucesso. Entre com sua nova senha.",
};

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const proximo = typeof sp.proximo === "string" ? sp.proximo : undefined;
  const motivo = typeof sp.motivo === "string" ? sp.motivo : typeof sp.erro === "string" ? sp.erro : null;
  const esc = await obterEscritorioPublico();

  return (
    <div className="grid w-full max-w-6xl overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--sombra-card)] md:grid-cols-[1.15fr_1fr]">
      <section className="relative isolate flex flex-col justify-between gap-8 overflow-hidden p-6 [background:var(--fundo-heroi)] sm:p-10">
        <div className="space-y-6">
          <Logo logoUrl={esc.logoUrl} tom="gradiente" versao={esc.logoUrl ? "vertical" : "horizontal"} className={esc.logoUrl ? "h-14" : "h-12"} />
          <div className="space-y-3">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{esc.nome_sistema}</h1>
            <p className="text-sm text-muted-foreground">{esc.descricao_sistema}</p>
          </div>
          <p className="text-base leading-relaxed text-foreground">{esc.mensagem_login}</p>
        </div>
        <IlustracaoEntrada className="hidden md:block" />
        <ul className="flex flex-wrap gap-2 text-xs font-medium text-foreground">
          <li className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur">
            <FileUp className="size-3.5 text-primary" /> Envio de documentos pelo computador ou celular
          </li>
          <li className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur">
            <ListChecks className="size-3.5 text-primary" /> Pendências do mês com prazos claros
          </li>
          <li className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur">
            <LineChart className="size-3.5 text-primary" /> Relatórios e saúde financeira da empresa
          </li>
          <li className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur">
            <ShieldCheck className="size-3.5 text-primary" /> Acesso protegido e dados separados por empresa
          </li>
        </ul>
      </section>
      <section className="flex flex-col justify-center p-6 sm:p-10">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="mb-1 text-2xl font-bold">Acesse sua conta</h2>
          <p className="mb-6 text-sm text-muted-foreground">Use o e-mail cadastrado pelo escritório.</p>
          <FormularioLogin proximo={proximo} aviso={motivo ? AVISOS[motivo] ?? null : null} />
        </div>
      </section>
    </div>
  );
}
