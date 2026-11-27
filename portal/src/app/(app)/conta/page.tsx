import type { Metadata } from "next";
import Link from "next/link";
import { Download, Laptop, ShieldCheck } from "lucide-react";
import { exigirSessao } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoEncerrarOutras, BotaoEncerrarSessao, FormAvisos, FormLgpd, FormPerfil, FormSenha, RemoverMfa } from "@/components/conta/conta";
import { formatarDataHora } from "@/lib/formatos";
import { AvisosNoAparelho } from "@/components/notificacoes/avisos";
import { envServidor } from "@/lib/env-servidor";

export const metadata: Metadata = { title: "Minha conta" };

const TIPO_LGPD: Record<string, string> = {
  acesso: "Acesso aos dados",
  correcao: "Correção",
  portabilidade: "Cópia dos dados",
  anonimizacao: "Anonimização",
  exclusao: "Exclusão",
  revogacao_consentimento: "Revogação de consentimento",
  informacao: "Dúvida",
};
const STATUS_LGPD: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  aberta: { rotulo: "Recebido", tom: "info" },
  em_andamento: { rotulo: "Em andamento", tom: "alerta" },
  concluida: { rotulo: "Concluído", tom: "sucesso" },
  recusada: { rotulo: "Não atendido", tom: "neutro" },
};

function navegador(ua: string | null) {
  if (!ua) return "Navegador desconhecido";
  const so = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return so ? `${nav} no ${so}` : nav;
}

export default async function MinhaConta() {
  const s = await exigirSessao();
  const [{ data: fatores }, { data: sessoes }, { data: pedidos }, { data: aparelhos }] = await Promise.all([
    s.supabase.auth.mfa.listFactors(),
    s.supabase.rpc("minhas_sessoes"),
    s.supabase.from("solicitacoes_titular").select("id, tipo, descricao, status, resposta, created_at, respondida_em").eq("user_id", s.usuarioId).order("created_at", { ascending: false }),
    s.supabase.from("push_aparelhos").select("id, endpoint, descricao, created_at, ultimo_envio_em").order("created_at", { ascending: false }),
  ]);
  const preferencias = (s.perfil.preferencias ?? {}) as Record<string, unknown>;
  const escritorio = s.perfil.tipo === "admin" || s.perfil.tipo === "equipe";
  const escolhaArquivos = String(preferencias.aviso_arquivos ?? "todas");
  const totp = (fatores?.totp ?? []).find((f) => f.status === "verified");
  const exige2fa = Boolean(s.estado.exige_2fa);

  return (
    <>
      <CabecalhoPagina titulo="Minha conta" descricao={`${s.perfil.email} · ${s.perfil.tipo === "cliente" ? "Cliente" : s.perfil.tipo === "admin" ? "Administrador do escritório" : "Equipe do escritório"}`} />
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seus dados</CardTitle>
            <CardDescription>O e-mail é o seu login e só pode ser alterado pelo escritório.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormPerfil nome={s.perfil.nome} telefone={s.perfil.telefone} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Verificação em duas etapas
            </CardTitle>
            <CardDescription>Além da senha, pede um código do aplicativo autenticador (Google Authenticator, Microsoft Authenticator…) a cada novo acesso.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {totp ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variante="sucesso">Ativada</Badge> desde {formatarDataHora(totp.created_at)}
                </p>
                <RemoverMfa fatorId={totp.id} obrigatorio={exige2fa} />
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm">
                  <Badge variante="alerta">Desativada</Badge> Recomendamos ativar para proteger os documentos da empresa.
                </p>
                <Button asChild>
                  <Link href="/mfa/cadastrar?proximo=/conta">Ativar agora</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 scroll-mt-20" id="avisos">
          <CardHeader>
            <CardTitle className="text-base">Avisos</CardTitle>
            <CardDescription>
              Os avisos sempre aparecem no sino do portal, na hora. Aqui você também pode recebê-los no celular ou no computador (mesmo com o portal
              fechado) e escolher o que chega por e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <AvisosNoAparelho usuarioId={s.usuarioId} chavePublica={envServidor.push()?.publica ?? null} aparelhos={aparelhos ?? []} />
            <FormAvisos
              email={preferencias.email_notificacoes !== false}
              escritorio={
                escritorio
                  ? {
                      admin: s.perfil.tipo === "admin",
                      arquivos: escolhaArquivos === "responsavel" || escolhaArquivos === "nenhuma" ? escolhaArquivos : "todas",
                      arquivosEmail: preferencias.aviso_arquivos_email === true,
                    }
                  : undefined
              }
              whatsapp={s.perfil.tipo === "cliente" ? { ativo: preferencias.whatsapp_avisos === true, telefone: s.perfil.telefone } : undefined}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Trocar senha</CardTitle>
            <CardDescription>A senha é guardada pelo serviço de autenticação, nunca pelo portal. Ao trocar, os outros dispositivos conectados precisam entrar de novo. Se esqueceu a senha, use “Esqueci minha senha” na tela de entrada.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSenha />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Laptop className="size-4" /> Dispositivos conectados
              </CardTitle>
              <CardDescription>Onde a sua conta está aberta agora. Encerre o que você não reconhecer.</CardDescription>
            </div>
            {(sessoes ?? []).length > 1 ? <BotaoEncerrarOutras /> : null}
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(sessoes ?? []).map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {navegador(x.user_agent)} {x.atual ? <Badge variante="sucesso">este dispositivo</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Entrou em {formatarDataHora(x.criada_em)} · última atividade {formatarDataHora(x.atualizada_em)}
                      {x.ip ? ` · IP ${x.ip}` : ""}
                      {x.aal === "aal2" ? " · com verificação em duas etapas" : ""}
                    </p>
                  </div>
                  {!x.atual ? <BotaoEncerrarSessao sessaoId={x.id} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="scroll-mt-24 xl:col-span-2" id="privacidade">
          <CardHeader>
            <CardTitle className="text-base">Privacidade e seus dados (LGPD)</CardTitle>
            <CardDescription>
              Você pode baixar uma cópia dos seus dados pessoais ou fazer um pedido ao escritório. Leia a{" "}
              <Link href="/privacidade" className="underline">
                Política de privacidade
              </Link>{" "}
              e os{" "}
              <Link href="/termos" className="underline">
                Termos de uso
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild variante="contorno">
                <a href="/api/conta/meus-dados">
                  <Download /> Baixar meus dados (arquivo JSON)
                </a>
              </Button>
              <FormLgpd />
            </div>
            {(pedidos ?? []).length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(pedidos ?? []).map((p) => {
                  const st = STATUS_LGPD[p.status] ?? { rotulo: p.status, tom: "neutro" as const };
                  return (
                    <li key={p.id} className="space-y-1 px-4 py-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{TIPO_LGPD[p.tipo] ?? p.tipo}</span>
                        <Badge variante={st.tom}>{st.rotulo}</Badge>
                        <span className="text-xs text-muted-foreground">{formatarDataHora(p.created_at)}</span>
                      </p>
                      {p.descricao ? <p className="text-muted-foreground">{p.descricao}</p> : null}
                      {p.resposta ? (
                        <p className="rounded-md bg-muted px-3 py-2">
                          <span className="font-medium">Resposta do escritório:</span> {p.resposta}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
