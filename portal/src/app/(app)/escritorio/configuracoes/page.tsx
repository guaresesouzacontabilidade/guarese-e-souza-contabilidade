import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Logo, urlLogo } from "@/components/marca/logo";
import {
  EnviarLogo,
  FormularioDadosEscritorio,
  FormularioLembretes,
  FormularioPortal,
  FormularioSeguranca,
} from "@/components/configuracoes/escritorio";
import { FormularioRetencaoPadrao, PoliticasRetencao, SolicitacoesTitular } from "@/components/configuracoes/privacidade";
import { envServidor } from "@/lib/env-servidor";
import { emailConfigurado } from "@/lib/email/enviar";
import { whatsappConectado } from "@/lib/whatsapp/cloud-api";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Configurações" };

const ABAS = ["dados", "portal", "seguranca", "notificacoes", "privacidade"] as const;
const ROTA = "/escritorio/configuracoes";

function chaveSecretaConfigurada() {
  try {
    envServidor.supabaseChaveSecreta();
    return true;
  } catch {
    return false;
  }
}

function LinhaIntegracao({ nome, ok, detalhe, ajuda }: { nome: string; ok: boolean; detalhe?: React.ReactNode; ajuda: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{nome}</p>
          {ok ? <Badge variante="sucesso">Configurado</Badge> : <Badge>Não configurado</Badge>}
        </div>
        {detalhe ? <p className="text-xs text-muted-foreground">{detalhe}</p> : null}
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>
    </li>
  );
}

/** Configurações do escritório (somente administradores). */
export default async function PaginaConfiguracoes({ searchParams }: PageProps<"/escritorio/configuracoes">) {
  const s = await exigirAdmin();
  const sp = await searchParams;
  const aba = parametro(sp, "aba", ABAS) || "dados";

  const { data: esc } = await s.supabase.from("escritorio").select("*").eq("id", 1).single();
  if (!esc) return <Alerta tom="perigo">Não foi possível carregar as configurações do escritório.</Alerta>;

  const { count: abertas } = await s.supabase.from("solicitacoes_titular").select("id", { count: "exact", head: true }).in("status", ["aberta", "em_andamento"]);

  const abas = [
    { valor: "dados", rotulo: "Dados do escritório", href: ROTA },
    { valor: "portal", rotulo: "Identidade do portal", href: `${ROTA}?aba=portal` },
    { valor: "seguranca", rotulo: "Segurança e envios", href: `${ROTA}?aba=seguranca` },
    { valor: "notificacoes", rotulo: "Lembretes e integrações", href: `${ROTA}?aba=notificacoes` },
    { valor: "privacidade", rotulo: "Privacidade (LGPD)", href: `${ROTA}?aba=privacidade`, contador: abertas ?? 0 },
  ];

  let conteudo: React.ReactNode = null;
  if (aba === "portal") {
    const logoUrl = urlLogo(esc.logo_path, esc.logo_atualizado_em);
    conteudo = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Textos do portal</CardTitle>
            <CardDescription>Exibidos na tela de entrada e nos e-mails enviados pelo portal.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioPortal inicial={esc} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Logomarca</CardTitle>
            <CardDescription>
              {esc.logo_atualizado_em ? `Atualizada em ${formatarDataHora(esc.logo_atualizado_em)}.` : "Nenhuma logomarca enviada: o portal usa a logomarca provisória."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-24 min-w-40 items-center justify-center rounded-lg border border-border bg-card p-3">
                <Logo logoUrl={logoUrl} className="h-14" />
              </div>
              <div className="flex h-24 min-w-40 items-center justify-center rounded-lg border border-sidebar-borda bg-sidebar p-3">
                <Logo logoUrl={logoUrl} tom="claro" className="h-14" />
              </div>
            </div>
            <EnviarLogo temLogo={Boolean(esc.logo_path)} />
          </CardContent>
        </Card>
      </div>
    );
  } else if (aba === "seguranca") {
    conteudo = (
      <Card>
        <CardContent className="pt-5">
          {s.aal !== "aal2" ? (
            <Alerta tom="info" className="mb-4">
              Seu usuário ainda não usa a verificação em duas etapas. Ative-a no seu perfil antes de exigi-la da equipe.
            </Alerta>
          ) : null}
          <FormularioSeguranca inicial={esc} />
        </CardContent>
      </Card>
    );
  } else if (aba === "notificacoes") {
    const smtp = envServidor.smtp();
    const tokenWhatsapp = Boolean(envServidor.whatsapp());
    const whatsappOk = whatsappConectado({ phoneNumberId: esc.whatsapp_phone_number_id, modelo: esc.whatsapp_template_lembrete, idioma: esc.whatsapp_template_idioma });
    conteudo = (
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Lembretes e WhatsApp</CardTitle>
            <CardDescription>Os lembretes são enviados pela rotina diária aos clientes com itens pendentes no checklist.</CardDescription>
          </CardHeader>
          <CardContent>
            {esc.lembretes_whatsapp_ativo && !whatsappOk ? (
              <Alerta tom="alerta" className="mb-4">
                Os lembretes por WhatsApp estão ativados, mas a integração não está completa. Nenhuma mensagem é enviada até que o token, o Phone Number ID e o modelo estejam configurados.
              </Alerta>
            ) : null}
            {esc.lembretes_email_ativo && !emailConfigurado() ? (
              <Alerta tom="alerta" className="mb-4">
                Os lembretes por e-mail estão ativados, mas o envio de e-mail (SMTP) não está configurado no servidor. Os clientes recebem apenas o aviso no portal.
              </Alerta>
            ) : null}
            <FormularioLembretes inicial={esc} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Situação das integrações</CardTitle>
            <CardDescription>Configuradas por variáveis de ambiente no servidor. Chaves e senhas nunca são exibidas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              <LinhaIntegracao
                nome="E-mail (SMTP)"
                ok={Boolean(smtp)}
                detalhe={smtp ? `Remetente: ${smtp.remetente}` : undefined}
                ajuda="Convites, notificações e lembretes por e-mail. Variáveis SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM."
              />
              <LinhaIntegracao
                nome="WhatsApp Business"
                ok={whatsappOk}
                detalhe={
                  whatsappOk
                    ? undefined
                    : `Token: ${tokenWhatsapp ? "informado" : "ausente"} · Phone Number ID: ${esc.whatsapp_phone_number_id ? "informado" : "ausente"} · Modelo: ${esc.whatsapp_template_lembrete ? "informado" : "ausente"}`
                }
                ajuda="Token na variável WHATSAPP_TOKEN; número e modelo nesta página."
              />
              <LinhaIntegracao nome="Antivírus (ClamAV)" ok={Boolean(envServidor.clamav())} ajuda="Verificação dos arquivos enviados. Variáveis CLAMAV_HOST e CLAMAV_PORT." />
              <LinhaIntegracao nome="Leitura automática (OCR)" ok={envServidor.ocrAtivo()} ajuda="Extração de dados de guias e comprovantes. Desative com OCR_ATIVO=false." />
              <LinhaIntegracao nome="Rotinas agendadas" ok={Boolean(envServidor.cronSecret())} ajuda="Checklist do mês, lembretes e processamento em segundo plano. Variável CRON_SECRET." />
              <LinhaIntegracao nome="Chave de serviço do Supabase" ok={chaveSecretaConfigurada()} ajuda="Necessária para convites e processamento. Variável SUPABASE_SECRET_KEY." />
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  } else if (aba === "privacidade") {
    const [{ data: politicas }, { data: categorias }, { data: solicitacoes }, vencidos] = await Promise.all([
      s.supabase.from("politicas_retencao").select("categoria_codigo, anos, observacao, updated_at").order("categoria_codigo"),
      s.supabase.from("categorias_documento").select("codigo, nome").order("ordem"),
      s.supabase
        .from("solicitacoes_titular")
        .select("id, tipo, descricao, status, resposta, email, created_at, respondida_em, perfil:perfis!solicitacoes_titular_user_id_fkey(nome)")
        .order("created_at", { ascending: false })
        .limit(100),
      s.supabase.rpc("documentos_retencao_vencida", { p_limite: 100 }),
    ]);
    const listaVencidos = vencidos.data ?? [];
    conteudo = (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Solicitações de titulares de dados</CardTitle>
            <CardDescription>Pedidos feitos pelos usuários com base na LGPD. Responda dentro do prazo legal (até 15 dias para acesso).</CardDescription>
          </CardHeader>
          <CardContent>
            <SolicitacoesTitular
              solicitacoes={(solicitacoes ?? []).map((x) => ({
                id: x.id,
                tipo: x.tipo,
                descricao: x.descricao,
                status: x.status,
                resposta: x.resposta,
                email: x.email,
                created_at: x.created_at,
                respondida_em: x.respondida_em,
                nome: (x.perfil as unknown as { nome: string } | null)?.nome ?? null,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Retenção de documentos</CardTitle>
            <CardDescription>Por quanto tempo os documentos são guardados antes de poderem ser expurgados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormularioRetencaoPadrao anos={esc.retencao_padrao_anos} />
            <PoliticasRetencao politicas={politicas ?? []} categorias={categorias ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Documentos com prazo de retenção vencido</CardTitle>
            <CardDescription>
              Somente para revisão. Nenhum documento é excluído automaticamente: o expurgo exige decisão do administrador e fica registrado na auditoria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vencidos.error ? (
              <Alerta tom="perigo">Não foi possível consultar os documentos com retenção vencida.</Alerta>
            ) : listaVencidos.length ? (
              <>
                <Table>
                  <THead>
                    <tr>
                      <Th>Documento</Th>
                      <Th>Empresa</Th>
                      <Th className="hidden md:table-cell">Competência</Th>
                      <Th className="hidden md:table-cell">Retenção</Th>
                      <Th>Venceu em</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {listaVencidos.map((d) => (
                      <Tr key={d.documento_id}>
                        <Td className="max-w-xs truncate text-sm">
                          <Link href={`/e/${d.empresa_id}/documentos/${d.documento_id}`} className="hover:underline">
                            {d.nome_original}
                          </Link>
                        </Td>
                        <Td className="text-sm">{d.empresa_nome}</Td>
                        <Td className="hidden text-sm md:table-cell">{formatarCompetencia(d.competencia)}</Td>
                        <Td className="hidden text-sm md:table-cell">{d.anos_retencao} ano(s)</Td>
                        <Td className="whitespace-nowrap text-sm">{formatarData(d.vence_em)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {listaVencidos.length >= 100 ? <p className="mt-2 text-xs text-muted-foreground">Exibindo os 100 documentos mais antigos.</p> : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum documento ultrapassou o prazo de retenção.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  } else {
    conteudo = (
      <Card>
        <CardContent className="pt-5">
          <FormularioDadosEscritorio inicial={esc} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Configurações"
        descricao={`Dados do escritório, identidade do portal, segurança, lembretes e privacidade. Última alteração em ${formatarDataHora(esc.updated_at)}.`}
      />
      <AbasLink abas={abas} ativa={aba} />
      {conteudo}
    </>
  );
}
