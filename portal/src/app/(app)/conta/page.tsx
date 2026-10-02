import type { Metadata } from "next";
import Link from "next/link";
import { LogOut, Monitor, ShieldCheck, ShieldPlus, Smartphone, Trash2 } from "lucide-react";
import { exigirSessao } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormularioPerfil, FormularioTrocaSenha } from "@/components/conta/formularios-conta";
import { formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL } from "@/lib/permissoes";
import { encerrarMinhaSessao, encerrarOutrasSessoes, removerFatorMfa } from "@/lib/conta/acoes";

export const metadata: Metadata = { title: "Minha conta e segurança" };

/** Descrição curta do navegador e do sistema a partir do user-agent. */
function descreverDispositivo(ua: string | null) {
  if (!ua) return { texto: "Dispositivo desconhecido", movel: false };
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const movel = /Mobile|Android|iPhone|iPad/.test(ua);
  const texto = [navegador, sistema].filter(Boolean).join(" no ") || "Navegador";
  return { texto, movel };
}

export default async function PaginaConta() {
  const s = await exigirSessao();
  const [{ data: fatores }, { data: sessoes, error: erroSessoes }] = await Promise.all([
    s.supabase.auth.mfa.listFactors(),
    s.supabase.rpc("minhas_sessoes"),
  ]);
  const totp = (fatores?.all ?? []).filter((f) => f.factor_type === "totp");
  const verificados = totp.filter((f) => f.status === "verified");
  const exige2fa = Boolean(s.estado.exige_2fa);
  const outrasSessoes = (sessoes ?? []).filter((x) => !x.atual && x.id !== s.sessaoId);

  return (
    <>
      <CabecalhoPagina
        titulo="Minha conta e segurança"
        descricao="Seus dados de acesso, senha, verificação em duas etapas e dispositivos conectados."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Meus dados</CardTitle>
            <CardDescription>O nome aparece para o escritório e nas mensagens que você envia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">E-mail de acesso</dt>
                <dd className="break-all font-medium">{s.perfil.email || s.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Perfil</dt>
                <dd className="font-medium">
                  {ROTULO_PAPEL[s.perfil.tipo] ?? s.perfil.tipo}
                  {s.perfil.cargo ? <span className="text-muted-foreground"> · {s.perfil.cargo}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Último acesso registrado</dt>
                <dd>{formatarDataHora(s.perfil.ultimo_acesso_em)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Termos aceitos</dt>
                <dd>{s.perfil.aceite_termos_em ? formatarDataHora(s.perfil.aceite_termos_em) : "—"}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">Para trocar o e-mail de acesso, fale com o escritório.</p>
            <FormularioPerfil nome={s.perfil.nome} telefone={s.perfil.telefone} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alterar senha</CardTitle>
            <CardDescription>Por segurança, confirme a senha atual antes de definir a nova.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioTrocaSenha />
            <p className="mt-3 text-xs text-muted-foreground">
              Esqueceu a senha atual? Saia do portal e use{" "}
              <Link href="/recuperar-senha" className="underline">
                Esqueci minha senha
              </Link>{" "}
              na tela de entrada.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Verificação em duas etapas
                {verificados.length ? <Badge variante="sucesso">Ativa</Badge> : <Badge variante="alerta">Desativada</Badge>}
              </CardTitle>
              <CardDescription>
                Além da senha, é pedido um código do aplicativo autenticador do seu celular a cada novo acesso.
              </CardDescription>
            </div>
            {!verificados.length ? (
              <Button asChild>
                <Link href="/mfa/cadastrar?proximo=/conta">
                  <ShieldPlus /> Ativar
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {exige2fa ? (
              <Alerta tom="info">O escritório exige a verificação em duas etapas para o seu perfil de acesso.</Alerta>
            ) : null}
            {!totp.length ? (
              <EstadoVazio
                icone={ShieldCheck}
                titulo="Nenhum aplicativo autenticador cadastrado"
                descricao="Recomendamos ativar: protege o seu acesso mesmo que alguém descubra a sua senha."
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Aplicativo</Th>
                    <Th className="hidden sm:table-cell">Cadastrado em</Th>
                    <Th>Situação</Th>
                    <Th className="w-10" />
                  </tr>
                </THead>
                <TBody>
                  {totp.map((f) => {
                    const ultimoObrigatorio = f.status === "verified" && exige2fa && verificados.length <= 1;
                    return (
                      <Tr key={f.id}>
                        <Td className="font-medium">{f.friendly_name || "Aplicativo autenticador"}</Td>
                        <Td className="hidden whitespace-nowrap text-sm sm:table-cell">{formatarDataHora(f.created_at)}</Td>
                        <Td>
                          {f.status === "verified" ? <Badge variante="sucesso">Verificado</Badge> : <Badge>Cadastro incompleto</Badge>}
                        </Td>
                        <Td>
                          {ultimoObrigatorio ? null : (
                            <BotaoAcao
                              variante="fantasma"
                              tamanho="iconeSm"
                              aria-label="Remover aplicativo"
                              title="Remover aplicativo"
                              acao={removerFatorMfa.bind(null, f.id)}
                              confirmar={{
                                titulo: "Remover este aplicativo autenticador?",
                                descricao:
                                  f.status === "verified" && verificados.length <= 1
                                    ? "A verificação em duas etapas será desativada e o seu acesso passará a depender apenas da senha."
                                    : "Os códigos deste aplicativo deixarão de ser aceitos.",
                                textoConfirmar: "Remover",
                                perigo: true,
                              }}
                            >
                              <Trash2 />
                            </BotaoAcao>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {verificados.length ? (
              <p className="text-xs text-muted-foreground">
                Trocou de celular? Remova o aplicativo antigo e ative novamente com o novo aparelho
                {exige2fa ? " (como a verificação é obrigatória, fale com o escritório se não tiver mais acesso ao aparelho antigo)" : ""}.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Sessões ativas</CardTitle>
              <CardDescription>Dispositivos conectados à sua conta. Encerre os que você não reconhece.</CardDescription>
            </div>
            {outrasSessoes.length ? (
              <BotaoAcao
                variante="contorno"
                acao={encerrarOutrasSessoes}
                confirmar={{
                  titulo: "Encerrar as outras sessões?",
                  descricao: "Os demais dispositivos precisarão entrar novamente. Esta sessão continua ativa.",
                  textoConfirmar: "Encerrar sessões",
                  perigo: true,
                }}
              >
                <LogOut /> Encerrar as outras sessões
              </BotaoAcao>
            ) : null}
          </CardHeader>
          <CardContent>
            {erroSessoes ? (
              <Alerta tom="perigo">Não foi possível carregar as sessões.</Alerta>
            ) : !sessoes?.length ? (
              <EstadoVazio icone={Monitor} titulo="Nenhuma sessão encontrada" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Dispositivo</Th>
                    <Th className="hidden md:table-cell">IP</Th>
                    <Th className="hidden sm:table-cell">Início</Th>
                    <Th>Última atividade</Th>
                    <Th className="w-10" />
                  </tr>
                </THead>
                <TBody>
                  {sessoes.map((x) => {
                    const atual = x.atual || x.id === s.sessaoId;
                    const d = descreverDispositivo(x.user_agent);
                    const Icone = d.movel ? Smartphone : Monitor;
                    return (
                      <Tr key={x.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <Icone className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1 font-medium">
                                {d.texto}
                                {atual ? <Badge variante="primario">Esta sessão</Badge> : null}
                                {x.aal === "aal2" ? <Badge variante="sucesso">2 etapas</Badge> : null}
                              </p>
                              {x.user_agent ? (
                                <p className="max-w-xs truncate text-xs text-muted-foreground" title={x.user_agent}>
                                  {x.user_agent}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </Td>
                        <Td className="hidden whitespace-nowrap text-sm md:table-cell">{x.ip || "—"}</Td>
                        <Td className="hidden whitespace-nowrap text-sm sm:table-cell">{formatarDataHora(x.criada_em)}</Td>
                        <Td className="whitespace-nowrap text-sm">
                          <span title={formatarDataHora(x.atualizada_em)}>{formatarRelativo(x.atualizada_em)}</span>
                        </Td>
                        <Td>
                          {atual ? null : (
                            <BotaoAcao
                              variante="fantasma"
                              tamanho="iconeSm"
                              aria-label="Encerrar sessão"
                              title="Encerrar sessão"
                              acao={encerrarMinhaSessao.bind(null, x.id)}
                              confirmar={{
                                titulo: "Encerrar esta sessão?",
                                descricao: `${d.texto}${x.ip ? ` (IP ${x.ip})` : ""} precisará entrar novamente.`,
                                textoConfirmar: "Encerrar",
                                perigo: true,
                              }}
                            >
                              <LogOut />
                            </BotaoAcao>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
