import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcessoPessoa, FormGeracao, FormMensagens, FormPix, FormRobo } from "@/components/honorarios/configuracoes";
import { NovaCategoria } from "@/components/honorarios/lancamentos";
import { AcoesSicredi, FormSicredi } from "@/components/honorarios/banco";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { TIPOS_CATEGORIA_ESCRITORIO, type TipoCategoriaEscritorio } from "@/lib/honorarios/comum";
import { textoPix } from "@/lib/honorarios/pix";
import { emailConfigurado } from "@/lib/email/enviar";
import { envServidor } from "@/lib/env-servidor";

export const metadata: Metadata = { title: "Configurações da cobrança" };

export default async function ConfiguracoesHonorarios() {
  const s = await exigirHonorarios();
  const admin = s.perfil.tipo === "admin";
  const [{ data: cfg }, { data: esc }, { data: categorias }, { data: equipe }, { data: acessos }] = await Promise.all([
    // Colunas da tela (o código secreto do aviso de Pix fica só no servidor)
    s.supabase
      .from("honorarios_config")
      .select(
        "pix_chave, pix_tipo, pix_nome, pix_cidade, geracao_automatica, dia_geracao, aprovacao_automatica, competencia_referencia, cobrar_encargos, multa_percentual, juros_mes_percentual, robo_ativo, regua, email_ativo, whatsapp_ativo, whatsapp_template, mensagens, recibo_automatico, recibo_publicar, banco_pix, banco_ambiente, banco_ativo, banco_cadastrado_em, banco_certificado_validade, banco_testado_em, banco_teste_ok, banco_teste_erro, banco_webhook_em",
      )
      .single(),
    s.supabase.from("escritorio").select("razao_social, cidade, whatsapp_phone_number_id").eq("id", 1).single(),
    s.supabase.from("escritorio_categorias").select("*").order("codigo"),
    admin ? s.supabase.from("perfis").select("id, nome, email").eq("tipo", "equipe").eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
    admin ? s.supabase.from("honorarios_acessos").select("user_id") : Promise.resolve({ data: [] }),
  ]);
  if (!cfg) return null;
  const config = { ...cfg, multa_percentual: Number(cfg.multa_percentual), juros_mes_percentual: Number(cfg.juros_mes_percentual) };
  const whatsappPronto = Boolean(envServidor.whatsapp() && esc?.whatsapp_phone_number_id && cfg.whatsapp_template);
  const comAcesso = new Set((acessos ?? []).map((a) => a.user_id));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <CabecalhoPagina titulo="Configurações da cobrança" voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }} />

      <Card>
        <CardHeader>
          <CardTitle>Pix do escritório</CardTitle>
          <CardDescription>
            Pix comum (QR code com a chave do escritório e o valor certo). A confirmação automática do pagamento chega com a ligação ao banco (API Pix); até lá, o escritório registra o pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormPix cfg={config} sugestao={{ nome: textoPix(esc?.razao_social ?? "", 25), cidade: textoPix(esc?.cidade ?? "", 15) }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Pix Sicredi — confirmação automática{" "}
            <Badge variante={cfg.banco_ativo ? "sucesso" : cfg.banco_teste_ok ? "info" : "neutro"}>
              {cfg.banco_ativo ? "Ligada" : cfg.banco_teste_ok ? "Testada, desligada" : cfg.banco_pix ? "Cadastrada, falta testar" : "Desconectada"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Com a API Pix do Sicredi, cada cobrança enviada é criada no banco (com multa e juros calculados pelo banco) e o pagamento dá baixa sozinho, com o recibo. Até a ativação, vale o Pix comum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cfg.banco_pix ? (
            <ul className="space-y-1 text-sm">
              <li>Ambiente: {cfg.banco_ambiente === "producao" ? "produção" : "homologação"} · cadastrado em {formatarDataHora(cfg.banco_cadastrado_em)}</li>
              <li>Certificado válido até {formatarData(cfg.banco_certificado_validade?.slice(0, 10))}</li>
              <li>
                Último teste: {cfg.banco_testado_em ? `${formatarDataHora(cfg.banco_testado_em)} — ${cfg.banco_teste_ok ? "funcionando" : `falhou (${cfg.banco_teste_erro})`}` : "ainda não testado"}
              </li>
              <li>Aviso automático de pagamento: {cfg.banco_webhook_em ? `cadastrado em ${formatarDataHora(cfg.banco_webhook_em)}` : "não cadastrado (o portal confere a cada 15 minutos)"}</li>
            </ul>
          ) : null}
          {admin ? (
            <>
              <AcoesSicredi cadastrado={Boolean(cfg.banco_pix)} testeOk={Boolean(cfg.banco_teste_ok)} ativo={cfg.banco_ativo} />
              <details className="rounded-lg border border-border p-3" open={!cfg.banco_pix}>
                <summary className="cursor-pointer text-sm font-medium">{cfg.banco_pix ? "Trocar as credenciais" : "Cadastrar as credenciais do Sicredi"}</summary>
                <div className="pt-4">
                  <FormSicredi cadastrado={Boolean(cfg.banco_pix)} />
                </div>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Só o administrador cadastra e liga a conexão com o banco.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobranças do mês, multa e recibo</CardTitle>
        </CardHeader>
        <CardContent>
          <FormGeracao cfg={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Robô de cobrança</CardTitle>
          <CardDescription>Lembra só as cobranças em aberto e para sozinho quando o cliente paga.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormRobo cfg={config} emailPronto={emailConfigurado()} whatsappPronto={whatsappPronto} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Textos das mensagens (e-mail)</CardTitle>
        </CardHeader>
        <CardContent>
          <FormMensagens cfg={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Linhas da DRE do escritório</CardTitle>
            <CardDescription>O plano de contas usado nos lançamentos e nos itens das cobranças.</CardDescription>
          </div>
          <NovaCategoria />
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm">
            {(categorias ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{c.codigo}</span>
                  {c.nome}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {TIPOS_CATEGORIA_ESCRITORIO[c.tipo as TipoCategoriaEscritorio] ?? c.tipo}
                  {!c.ativa ? <Badge>inativa</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {admin ? (
        <Card>
          <CardHeader>
            <CardTitle>Quem mexe no financeiro do escritório</CardTitle>
            <CardDescription>O administrador sempre tem acesso. Libere só para quem cuida do financeiro.</CardDescription>
          </CardHeader>
          <CardContent>
            {equipe?.length ? (
              <ul className="divide-y divide-border">
                {equipe.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      {p.nome} <span className="text-muted-foreground">· {p.email}</span>
                      {comAcesso.has(p.id) ? (
                        <Badge variante="sucesso" className="ml-2">
                          com acesso
                        </Badge>
                      ) : null}
                    </span>
                    <AcessoPessoa id={p.id} nome={p.nome} ativo={comAcesso.has(p.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguém na equipe além do administrador.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
