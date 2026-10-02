import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Bot, Clock, CloudDownload, FileSearch, HardDrive, Mail, MessageCircle, ShieldAlert } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { envServidor } from "@/lib/env-servidor";
import { whatsappConectado } from "@/lib/whatsapp/cloud-api";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BotaoTestarEmail,
  FormDadosEscritorio,
  FormLembretes,
  FormLogo,
  FormRetencao,
  FormSeguranca,
  ListaExpurgo,
  ResponderPedido,
} from "@/components/escritorio/configuracoes";
import { formatarDataHora, formatarRelativo } from "@/lib/formatos";

export const metadata: Metadata = { title: "Configurações" };

const ABAS = [
  { valor: "escritorio", rotulo: "Escritório" },
  { valor: "seguranca", rotulo: "Segurança" },
  { valor: "lembretes", rotulo: "Lembretes" },
  { valor: "integracoes", rotulo: "Integrações" },
  { valor: "privacidade", rotulo: "Privacidade (LGPD)" },
] as const;
type Aba = (typeof ABAS)[number]["valor"];

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
  aberta: { rotulo: "Novo", tom: "alerta" },
  em_andamento: { rotulo: "Em andamento", tom: "info" },
  concluida: { rotulo: "Concluído", tom: "sucesso" },
  recusada: { rotulo: "Não atendido", tom: "neutro" },
};

/** Tempo desde um instante (ms); "infinito" quando nunca aconteceu. */
function idadeMs(iso: string | null | undefined) {
  return iso ? Date.now() - Date.parse(iso) : Number.POSITIVE_INFINITY;
}
function diasAtras(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function Situacao({ ok, texto }: { ok: boolean | null; texto: string }) {
  return <Badge variante={ok === null ? "info" : ok ? "sucesso" : "neutro"}>{texto}</Badge>;
}

function Integracao({
  icone: Icone,
  titulo,
  situacao,
  children,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  situacao: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icone className="size-4" /> {titulo}
        </CardTitle>
        {situacao}
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

export default async function PaginaConfiguracoes({ searchParams }: PageProps<"/escritorio/configuracoes">) {
  const s = await exigirAdmin();
  const sp = await searchParams;
  const aba: Aba = ABAS.some((a) => a.valor === sp.aba) ? (sp.aba as Aba) : "escritorio";
  const { data: esc } = await s.supabase.from("escritorio").select("*").eq("id", 1).single();
  if (!esc) return <Alerta tom="perigo">Configurações do escritório não encontradas.</Alerta>;

  const abas = ABAS.map((a) => ({ ...a, href: a.valor === "escritorio" ? "/escritorio/configuracoes" : `/escritorio/configuracoes?aba=${a.valor}` }));
  let conteudo: React.ReactNode = null;

  if (aba === "escritorio") {
    const publico = await obterEscritorioPublico();
    conteudo = (
      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dados do escritório</CardTitle>
            <CardDescription>Aparecem na tela de entrada, nos e-mails e no cabeçalho dos relatórios em PDF.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormDadosEscritorio esc={esc} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logomarca</CardTitle>
            <CardDescription>A logomarca oficial do escritório já vem aplicada no menu, na tela de entrada e nos relatórios em PDF. Envie outra imagem só se quiser substituí-la.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormLogo logoUrl={publico.logoUrl} />
          </CardContent>
        </Card>
      </div>
    );
  } else if (aba === "seguranca") {
    const { data: seg } = await s.supabase.rpc("seguranca_usuarios");
    const { data: equipe } = await s.supabase.from("perfis").select("id").in("tipo", ["admin", "equipe"]).eq("ativo", true);
    const idsEquipe = new Set((equipe ?? []).map((p) => p.id));
    const semFator = (seg ?? []).filter((x) => idsEquipe.has(x.user_id) && !x.tem_2fa).length;
    conteudo = (
      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Acesso e arquivos</CardTitle>
            <CardDescription>As senhas são guardadas pelo serviço de autenticação (Supabase Auth), nunca pelo portal.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSeguranca esc={esc} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Situação da equipe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {semFator ? (
                <>
                  <Badge variante={esc.exigir_2fa_equipe ? "perigo" : "alerta"}>{semFator}</Badge> pessoa(s) da equipe sem verificação em duas etapas.
                </>
              ) : (
                <>
                  <Badge variante="sucesso">Toda a equipe</Badge> usa verificação em duas etapas.
                </>
              )}
            </p>
            <p className="text-muted-foreground">
              Veja cada pessoa em{" "}
              <Link href="/escritorio/equipe" className="underline">
                Equipe e permissões
              </Link>
              . O registro de entradas, downloads e alterações fica em{" "}
              <Link href="/escritorio/auditoria" className="underline">
                Auditoria
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  } else if (aba === "lembretes") {
    conteudo = (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lembretes automáticos de pendências</CardTitle>
          <CardDescription>
            A rotina diária avisa os clientes sobre documentos do checklist que ainda não foram enviados, conforme os dias abaixo. Nada é enviado por um canal que não esteja conectado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormLembretes esc={esc} whatsappToken={Boolean(envServidor.whatsapp())} />
        </CardContent>
      </Card>
    );
  } else if (aba === "integracoes") {
    const smtp = envServidor.smtp();
    const push = Boolean(envServidor.push());
    const wpp = whatsappConectado({ phoneNumberId: esc.whatsapp_phone_number_id, modelo: esc.whatsapp_template_lembrete, idioma: esc.whatsapp_template_idioma });
    const clamav = envServidor.clamav();
    const cron = Boolean(envServidor.cronSecret());
    const seteDias = diasAtras(7);
    const [{ data: rotinas }, { count: pendentes }, { count: falhas }, { count: comCertificado }] = await Promise.all([
      s.supabase.from("rotinas_status").select("rotina, ultima_execucao, ok, erro"),
      s.supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "pendente"),
      s.supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "falhou").gte("created_at", seteDias),
      s.supabase.from("notas_automaticas").select("empresa_id", { count: "exact", head: true }).gt("certificado_valido_ate", new Date().toISOString()),
    ]);
    const chaveCertificados = Boolean(envServidor.certificadosChave());
    const semRede = envServidor.notasSemRede();
    const fila = rotinas?.find((r) => r.rotina === "fila");
    const diaria = rotinas?.find((r) => r.rotina === "diaria");
    const filaAtrasada = idadeMs(fila?.ultima_execucao) > 30 * 60_000;
    const diariaAtrasada = idadeMs(diaria?.ultima_execucao) > 26 * 3_600_000;
    const faltaWpp = [
      !envServidor.whatsapp() ? "token de acesso (variável WHATSAPP_TOKEN na hospedagem)" : null,
      !esc.whatsapp_phone_number_id ? "identificador do número (aba Lembretes)" : null,
      !esc.whatsapp_template_lembrete ? "modelo de mensagem aprovado pela Meta (aba Lembretes)" : null,
    ].filter(Boolean);

    conteudo = (
      <div className="space-y-5">
        <Alerta tom="info">
          Chaves e senhas das integrações ficam guardadas somente na hospedagem (variáveis de ambiente) e nunca aparecem nesta tela nem no navegador. Quando uma integração está
          desconectada, o portal não finge que enviou: o envio fica registrado como “não configurado”.
        </Alerta>
        <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <Integracao icone={Mail} titulo="E-mail (SMTP)" situacao={<Situacao ok={Boolean(smtp)} texto={smtp ? "Conectado" : "Desconectado"} />}>
            {smtp ? (
              <>
                <p>
                  Envio pelo servidor <span className="font-medium text-foreground">{smtp.host}</span>, remetente <span className="font-medium text-foreground">{smtp.remetente}</span>.
                </p>
                <BotaoTestarEmail />
              </>
            ) : (
              <p>
                Sem e-mail configurado, convites mostram um link para copiar e enviar por WhatsApp, e lembretes aparecem só dentro do portal. Para ativar, cadastre na hospedagem as
                variáveis SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM (veja o guia de configuração).
              </p>
            )}
          </Integracao>

          <Integracao icone={BellRing} titulo="Notificações no aparelho (Web Push)" situacao={<Situacao ok={push} texto={push ? "Conectado" : "Desconectado"} />}>
            {push ? (
              <p>
                Cada pessoa ativa em Minha conta → Avisos, no celular ou no computador. O aviso é entregue pelo serviço de notificação do próprio navegador (Google, Apple,
                Mozilla ou Microsoft), com o conteúdo cifrado de ponta a ponta.
              </p>
            ) : (
              <p>
                Desconectado até a ativação: faltam as chaves de notificação (variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY na hospedagem). Enquanto isso, os avisos aparecem
                só no sino do portal.
              </p>
            )}
          </Integracao>

          <Integracao icone={MessageCircle} titulo="WhatsApp Business (Meta)" situacao={<Situacao ok={wpp} texto={wpp ? "Conectado" : "Desconectado"} />}>
            {wpp ? (
              <p>
                Lembretes por WhatsApp usam o modelo “{esc.whatsapp_template_lembrete}”. {esc.lembretes_whatsapp_ativo ? "Envio ativado." : "O envio está desligado na aba Lembretes."}{" "}
                {esc.avisos_whatsapp_ativo && esc.whatsapp_template_aviso
                  ? `Avisos de documentos, mensagens e solicitações usam o modelo “${esc.whatsapp_template_aviso}”.`
                  : "Avisos de documentos, mensagens e solicitações por WhatsApp: desligados (aba Lembretes)."}
              </p>
            ) : (
              <p>Desconectado até a ativação. Falta: {faltaWpp.join("; ")}. Nenhuma mensagem é enviada por WhatsApp enquanto isso.</p>
            )}
          </Integracao>

          <Integracao
            icone={Clock}
            titulo="Rotinas automáticas"
            situacao={<Situacao ok={cron && !filaAtrasada && !diariaAtrasada} texto={!cron ? "Desconectado" : filaAtrasada || diariaAtrasada ? "Verificar" : "Funcionando"} />}
          >
            {!cron ? (
              <p>Falta cadastrar a variável CRON_SECRET na hospedagem. Sem ela, leitura de documentos, e-mails e lembretes não rodam sozinhos.</p>
            ) : (
              <ul className="space-y-1">
                <li>
                  Fila de tarefas (a cada 5 minutos):{" "}
                  {fila ? (
                    <span className={fila.ok && !filaAtrasada ? "" : "text-perigo"}>
                      última execução {formatarRelativo(fila.ultima_execucao)}
                      {fila.ok ? "" : " — com erro"}
                    </span>
                  ) : (
                    <span className="text-perigo">ainda não executou</span>
                  )}
                </li>
                <li>
                  Rotina diária (checklist, recorrências e lembretes):{" "}
                  {diaria ? (
                    <span className={diaria.ok && !diariaAtrasada ? "" : "text-perigo"}>
                      última execução em {formatarDataHora(diaria.ultima_execucao)}
                      {diaria.ok ? "" : " — com erro"}
                    </span>
                  ) : (
                    <span className="text-perigo">ainda não executou</span>
                  )}
                </li>
                <li>
                  Tarefas aguardando: {pendentes ?? 0} · com falha nos últimos 7 dias: {falhas ?? 0}
                </li>
              </ul>
            )}
          </Integracao>

          <Integracao
            icone={CloudDownload}
            titulo="Notas automáticas (SEFAZ e NFS-e Nacional)"
            situacao={
              <Situacao
                ok={semRede ? null : chaveCertificados && Boolean(comCertificado)}
                texto={semRede ? "Desligada neste ambiente" : !chaveCertificados ? "Desconectada" : comCertificado ? `Ativa em ${comCertificado} empresa(s)` : "Aguardando certificados"}
              />
            }
          >
            <p>
              Busca as NF-e recebidas (SEFAZ – Ambiente Nacional) e as NFS-e (Ambiente Nacional da NFS-e) de cada empresa com o certificado digital A1 dela, cadastrado em
              Notas automáticas pelo cliente ou pela equipe (com a autorização do cliente). Sem certificado, nenhuma consulta é feita.
            </p>
            {semRede ? (
              <p className="mt-2">Este ambiente é de demonstração ou teste (NOTAS_AUTOMATICAS_SEM_REDE): nenhuma consulta fiscal sai daqui.</p>
            ) : !chaveCertificados ? (
              <p className="mt-2">
                Desconectada até a ativação: falta a chave de criptografia dos certificados (variável CERTIFICADOS_CHAVE na hospedagem). Sem ela, nenhum certificado é aceito.
              </p>
            ) : (
              <p className="mt-2">
                <Link href="/escritorio/notas-automaticas" className="text-primary hover:underline">
                  Ver a situação de cada empresa
                </Link>
              </p>
            )}
          </Integracao>

          <Integracao icone={FileSearch} titulo="Leitura de documentos (OCR)" situacao={<Situacao ok={envServidor.ocrAtivo()} texto={envServidor.ocrAtivo() ? "Ativa" : "Desligada"} />}>
            <p>
              Fotos e PDFs digitalizados são lidos no próprio servidor do portal (Tesseract). Nenhum documento é enviado a serviços de terceiros, e os dados lidos são sempre
              conferidos por uma pessoa antes de virar lançamento.
            </p>
          </Integracao>

          <Integracao icone={ShieldAlert} titulo="Antivírus (ClamAV)" situacao={<Situacao ok={Boolean(clamav)} texto={clamav ? "Conectado" : "Desconectado"} />}>
            <p>
              {clamav
                ? "Cada arquivo enviado é verificado antes de ficar disponível."
                : "Opcional. Os arquivos já passam por verificação de tipo, tamanho e conteúdo; a varredura antivírus fica desligada até um servidor ClamAV ser configurado (CLAMAV_HOST)."}
            </p>
          </Integracao>

          <Integracao icone={Bot} titulo="Inteligência artificial" situacao={<Situacao ok={null} texto="Não utilizada" />}>
            <p>
              O portal não envia documentos nem dados de clientes para serviços de inteligência artificial. Sugestões de conciliação, classificação e resumos dos relatórios são
              calculados por regras dentro do próprio portal.
            </p>
          </Integracao>

          <Integracao icone={HardDrive} titulo="Banco de dados e arquivos" situacao={<Situacao ok texto="Conectado" />}>
            <p>Supabase (região São Paulo). Arquivos ficam em armazenamento privado; cada download usa um link temporário e é registrado.</p>
          </Integracao>
        </div>
      </div>
    );
  } else {
    const [{ data: pedidos }, { data: categorias }, { data: politicas }, { data: vencidos }] = await Promise.all([
      s.supabase
        .from("solicitacoes_titular")
        .select("id, tipo, descricao, status, resposta, created_at, respondida_em, email, perfil:perfis!solicitacoes_titular_user_id_fkey(nome, email)")
        .order("created_at", { ascending: false })
        .limit(100),
      s.supabase.from("categorias_documento").select("codigo, nome, grupo, ordem").eq("ativo", true).order("ordem"),
      s.supabase.from("politicas_retencao").select("categoria_codigo, anos, observacao"),
      s.supabase.rpc("documentos_retencao_vencida", { p_limite: 200 }),
    ]);
    const pol = new Map((politicas ?? []).map((p) => [p.categoria_codigo, p]));
    const abertos = (pedidos ?? []).filter((p) => p.status === "aberta" || p.status === "em_andamento");
    const ordenados = [...abertos, ...(pedidos ?? []).filter((p) => !abertos.includes(p))];
    conteudo = (
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pedidos dos titulares {abertos.length ? <Badge variante="alerta">{abertos.length} em aberto</Badge> : null}</CardTitle>
            <CardDescription>
              Pedidos feitos pelos usuários em Minha conta (acesso, correção, cópia, exclusão…). A LGPD prevê resposta em até 15 dias. Para exclusão, use “Anonimizar dados” na página
              da pessoa em Equipe e permissões; documentos fiscais e contábeis seguem guardados pelo prazo legal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ordenados.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {ordenados.map((p) => {
                  const st = STATUS_LGPD[p.status] ?? { rotulo: p.status, tom: "neutro" as const };
                  const perfil = p.perfil as unknown as { nome: string; email: string } | null;
                  return (
                    <li key={p.id} className="space-y-1.5 px-4 py-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{TIPO_LGPD[p.tipo] ?? p.tipo}</span>
                        <Badge variante={st.tom}>{st.rotulo}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {perfil?.nome ?? p.email ?? "Usuário removido"} · {formatarDataHora(p.created_at)}
                        </span>
                      </p>
                      {p.descricao ? <p className="whitespace-pre-line text-muted-foreground">{p.descricao}</p> : null}
                      {p.resposta ? (
                        <p className="rounded-md bg-muted px-3 py-2">
                          <span className="font-medium">Resposta:</span> {p.resposta}
                        </p>
                      ) : null}
                      <ResponderPedido pedidoId={p.id} statusAtual={p.status} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum pedido recebido.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prazos de guarda dos documentos</CardTitle>
            <CardDescription>
              Por quanto tempo os arquivos ficam guardados. Os prazos sugeridos seguem as obrigações fiscais e trabalhistas; ajuste conforme a orientação do escritório.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormRetencao
              padrao={esc.retencao_padrao_anos}
              categorias={(categorias ?? []).map((c) => ({ codigo: c.codigo, nome: c.nome, grupo: c.grupo, anos: pol.get(c.codigo)?.anos ?? null, observacao: pol.get(c.codigo)?.observacao ?? null }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documentos com prazo de guarda vencido</CardTitle>
            <CardDescription>Nada é apagado automaticamente: revise a lista e elimine somente o que não precisa mais ser guardado.</CardDescription>
          </CardHeader>
          <CardContent>
            {vencidos?.length ? (
              <ListaExpurgo documentos={vencidos} />
            ) : (
              <EstadoVazio titulo="Nenhum documento com prazo vencido" descricao="Quando houver, eles aparecem aqui para revisão." />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <CabecalhoPagina titulo="Configurações" descricao="Dados do escritório, segurança, lembretes, integrações e privacidade. Somente administradores acessam esta página." />
      <AbasLink abas={abas} ativa={aba} className="mb-5" />
      {conteudo}
      <p className="mt-6 text-xs text-muted-foreground">Última alteração das configurações: {formatarDataHora(esc.updated_at)}.</p>
    </>
  );
}
