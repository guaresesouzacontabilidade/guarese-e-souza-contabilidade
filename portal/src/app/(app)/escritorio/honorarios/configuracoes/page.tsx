import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcessoPessoa, FormGeracao, FormMensagens, FormPix, FormRobo } from "@/components/honorarios/configuracoes";
import { NovaCategoria } from "@/components/honorarios/lancamentos";
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
    s.supabase.from("honorarios_config").select("*").single(),
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
