import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, ExternalLink, FileDown, Pause, Pencil, Play, Receipt, Send } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BotaoAcao } from "@/components/ui/acao";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcaoComMotivo, BaixarCobranca, CopiarPix } from "@/components/honorarios/cobrancas";
import { ConferirNoBanco } from "@/components/honorarios/banco";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { alternarRoboCobranca, aprovarCobrancas, reenviarCobranca } from "@/lib/honorarios/acoes";
import { numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { pixDaCobranca, valorParaPagar } from "@/lib/honorarios/montar";
import { qrSvg } from "@/lib/honorarios/qr";
import { numeroRecibo } from "@/lib/recibos/comum";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { FORMAS_PAGAMENTO } from "@/lib/recibos/comum";
import { envPublico } from "@/lib/env";

export const metadata: Metadata = { title: "Cobrança" };

const MOTIVOS: Record<string, string> = { emissao: "Cobrança enviada", manual: "Reenvio manual", pagamento: "Agradecimento e recibo" };
const STATUS: Record<string, { rotulo: string; tom: "neutro" | "sucesso" | "alerta" | "perigo" | "info" }> = {
  pendente: { rotulo: "Na fila", tom: "info" },
  enviado: { rotulo: "Enviado", tom: "sucesso" },
  falhou: { rotulo: "Falhou", tom: "perigo" },
  nao_configurado: { rotulo: "Canal desconectado", tom: "alerta" },
  desativado: { rotulo: "Dispensado", tom: "neutro" },
  pulado: { rotulo: "Pulado (fim de semana/feriado)", tom: "neutro" },
  sem_contato: { rotulo: "Sem contato cadastrado", tom: "alerta" },
};

function etapa(motivo: string, dias: number | null) {
  if (motivo !== "lembrete" || dias === null) return MOTIVOS[motivo] ?? motivo;
  if (dias < 0) return `Lembrete ${-dias} dia(s) antes`;
  if (dias === 0) return "Lembrete no dia do vencimento";
  return `Lembrete ${dias} dia(s) depois`;
}

export default async function Cobranca({ params, searchParams }: PageProps<"/escritorio/honorarios/cobrancas/[id]">) {
  const s = await exigirHonorarios();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: itens }, { data: lembretes }, { data: recibo }] = await Promise.all([
    s.supabase.from("honorarios_cobranca_itens").select("*, categoria:escritorio_categorias(codigo, nome)").eq("cobranca_id", id).order("ordem"),
    s.supabase.from("honorarios_lembretes").select("*, envio:envios(status, erro, enviado_em, destinatario)").eq("cobranca_id", id).order("criado_em", { ascending: false }),
    c.recibo_id ? s.supabase.from("recibos_honorarios").select("id, ano, numero, situacao").eq("id", c.recibo_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const { data: cfgBanco } = await s.supabase.from("honorarios_config").select("banco_ativo").single();
  const bancoAtivo = Boolean(cfgBanco?.banco_ativo) && c.situacao === "aberta";
  const hoje = hojeISO();
  const sit = situacaoExibida(c, hoje);
  const pagar = valorParaPagar(c, hoje);
  const pix = pixDaCobranca(c, pagar.valor);
  const qr = pix ? await qrSvg(pix) : null;
  const link = c.token_publico ? `${envPublico.siteUrl()}/pagar/${c.token_publico}` : null;
  const rotulo = `nº ${numeroCobranca(c)}`;

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {c.pagador_nome} <Badge variante={sit.tom === "neutro" ? "neutro" : sit.tom}>{sit.rotulo}</Badge>
          </span>
        }
        descricao={`Cobrança ${rotulo} · ${c.descricao}`}
        voltar={{ href: "/escritorio/honorarios/cobrancas", rotulo: "Cobranças" }}
        acoes={
          <Button asChild variante="contorno">
            <a href={`/api/honorarios/${c.id}/pdf`} target="_blank" rel="noopener">
              <FileDown /> PDF da cobrança
            </a>
          </Button>
        }
      />
      {sp.salvo ? <Alerta tom="sucesso">Cobrança salva.</Alerta> : null}

      <div className="flex flex-wrap gap-2">
        {c.situacao === "rascunho" ? (
          <BotaoAcao acao={aprovarCobrancas.bind(null, [c.id])} confirmar={{ titulo: "Enviar ao cliente?", descricao: "Sai por e-mail e WhatsApp (os canais ligados) com o Pix, e aparece no portal do cliente.", textoConfirmar: "Enviar" }}>
            <Send /> Enviar ao cliente
          </BotaoAcao>
        ) : null}
        {c.situacao === "aberta" ? <BaixarCobranca id={c.id} valor={String(c.valor)} valorHoje={pagar.valor} hoje={hoje} rotulo={rotulo} /> : null}
        {c.situacao === "aberta" ? (
          <BotaoAcao variante="contorno" acao={reenviarCobranca.bind(null, c.id)}>
            <Send /> Reenviar ao cliente
          </BotaoAcao>
        ) : null}
        {c.situacao === "aberta" ? (
          <BotaoAcao variante="fantasma" acao={alternarRoboCobranca.bind(null, c.id, !c.robo_ativo)}>
            {c.robo_ativo ? <Pause /> : <Play />} {c.robo_ativo ? "Pausar lembretes" : "Ligar lembretes"}
          </BotaoAcao>
        ) : null}
        {c.situacao === "rascunho" || c.situacao === "aberta" ? (
          <Button asChild variante="fantasma">
            <Link href={`/escritorio/honorarios/cobrancas/${c.id}/editar`}>
              <Pencil /> Editar
            </Link>
          </Button>
        ) : null}
        {c.situacao === "rascunho" || c.situacao === "aberta" ? <AcaoComMotivo id={c.id} tipo="cancelar" /> : null}
        {c.situacao === "paga" && recibo ? (
          <Button asChild variante="contorno">
            <a href={`/api/recibos/${recibo.id}/pdf`} target="_blank" rel="noopener">
              <Receipt /> Recibo nº {numeroRecibo(recibo)}
            </a>
          </Button>
        ) : null}
        {c.situacao === "paga" ? <AcaoComMotivo id={c.id} tipo="estornar" /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Itens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Descrição</Th>
                    <Th>Linha da DRE</Th>
                    <Th className="text-right">Qtde.</Th>
                    <Th className="text-right">Total</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(itens ?? []).map((i) => {
                    const cat = i.categoria as unknown as { codigo: string; nome: string } | null;
                    return (
                      <Tr key={i.id}>
                        <Td>{i.descricao}</Td>
                        <Td className="text-xs text-muted-foreground">{cat ? `${cat.codigo} ${cat.nome}` : "—"}</Td>
                        <Td className="text-right">{Number(i.quantidade).toLocaleString("pt-BR")}</Td>
                        <Td className="whitespace-nowrap text-right">{formatarMoeda(i.valor)}</Td>
                      </Tr>
                    );
                  })}
                  <Tr>
                    <Td colSpan={3} className="font-semibold">
                      Total
                    </Td>
                    <Td className="whitespace-nowrap text-right font-semibold">{formatarMoeda(c.valor)}</Td>
                  </Tr>
                </TBody>
              </Table>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Vencimento</dt>
                <dd>{formatarData(c.vencimento)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cliente</dt>
                <dd>
                  {c.empresa_id ? (
                    <Link href={`/escritorio/empresas/${c.empresa_id}`} className="hover:underline">
                      {c.pagador_nome}
                    </Link>
                  ) : (
                    c.pagador_nome
                  )}
                  {c.pagador_documento ? <span className="text-muted-foreground"> · {formatarDocumento(c.pagador_documento)}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">E-mail para cobrança</dt>
                <dd>{c.contato_email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">WhatsApp</dt>
                <dd>
                  {c.contato_whatsapp ? formatarTelefone(c.contato_whatsapp.replace(/^55/, "")) : "—"}
                  {c.contato_whatsapp && !c.whatsapp_autorizado ? <span className="text-muted-foreground"> (sem autorização: não recebe)</span> : null}
                </dd>
              </div>
              {c.situacao === "paga" ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">Pago em</dt>
                    <dd>
                      {formatarData(c.pago_em)} · {formatarMoeda(c.valor_pago)} {c.forma_pagamento ? `(${FORMAS_PAGAMENTO[c.forma_pagamento] ?? c.forma_pagamento})` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Separado na DRE</dt>
                    <dd>
                      multa {formatarMoeda(c.multa)} · juros {formatarMoeda(c.juros)} · desconto {formatarMoeda(c.desconto)}
                    </dd>
                  </div>
                </>
              ) : null}
              {c.situacao === "cancelada" ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Cancelada</dt>
                  <dd>
                    {formatarDataHora(c.cancelada_em)} — {c.motivo_cancelamento}
                  </dd>
                </div>
              ) : null}
              {c.baixa_observacao ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Observação</dt>
                  <dd>{c.baixa_observacao}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.situacao === "rascunho" ? (
              <p className="text-muted-foreground">O Pix é criado quando a cobrança é enviada ao cliente.</p>
            ) : pix && qr ? (
              <>
                {/* QR desenhado no servidor a partir do Pix copia e cola */}
                <div className="mx-auto w-48 rounded-lg border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
                <p className="text-center">
                  {pagar.atualizado ? (
                    <>
                      Valor de hoje: <strong>{formatarMoeda(pagar.valor)}</strong>
                      <span className="block text-xs text-muted-foreground">
                        com multa {formatarMoeda(pagar.atualizado.multa)} e juros {formatarMoeda(pagar.atualizado.juros)} ({pagar.atualizado.dias} dias de atraso)
                      </span>
                    </>
                  ) : (
                    <>
                      Valor: <strong>{formatarMoeda(pagar.valor)}</strong>
                    </>
                  )}
                </p>
                <p className="break-all rounded-md border border-dashed border-border bg-muted/40 p-2 font-mono text-xs">{pix}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <CopiarPix codigo={pix} />
                  {link ? (
                    <Button asChild variante="fantasma" tamanho="sm">
                      <a href={link} target="_blank" rel="noopener">
                        <ExternalLink /> Página de pagamento
                      </a>
                    </Button>
                  ) : null}
                </div>
                {c.banco_pix ? (
                  <p className="text-xs text-muted-foreground">Pix do Sicredi: o banco calcula multa e juros na hora e o pagamento dá baixa sozinho.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Pix comum com a chave do escritório: ao cair o dinheiro, registre o pagamento aqui.</p>
                )}
                {c.banco_erro ? <Alerta tom="alerta">Banco: {c.banco_erro}</Alerta> : null}
                {bancoAtivo ? (
                  <div className="flex justify-center">
                    <ConferirNoBanco id={c.id} criar={!c.banco_txid} />
                  </div>
                ) : null}
              </>
            ) : c.situacao === "aberta" ? (
              <Alerta tom="alerta">A cobrança foi enviada sem Pix (não havia chave cadastrada). Cadastre a chave nas configurações; as próximas cobranças saem com QR code.</Alerta>
            ) : (
              <p className="text-muted-foreground">{c.situacao === "paga" ? "Cobrança paga." : "Cobrança cancelada."}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Robô de cobrança — histórico
          </CardTitle>
          {c.situacao === "aberta" ? <Badge variante={c.robo_ativo ? "sucesso" : "neutro"}>{c.robo_ativo ? "Lembretes ligados" : "Lembretes pausados"}</Badge> : null}
        </CardHeader>
        <CardContent>
          {lembretes?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Quando</Th>
                    <Th>Etapa</Th>
                    <Th>Canal</Th>
                    <Th>Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {lembretes.map((l) => {
                    const envio = l.envio as unknown as { status: string; erro: string | null; enviado_em: string | null; destinatario: string } | null;
                    const st = STATUS[envio?.status ?? l.situacao] ?? { rotulo: envio?.status ?? l.situacao, tom: "neutro" as const };
                    return (
                      <Tr key={l.id}>
                        <Td className="whitespace-nowrap text-sm">{formatarDataHora(envio?.enviado_em ?? l.criado_em)}</Td>
                        <Td className="text-sm">{etapa(l.motivo, l.dias)}</Td>
                        <Td className="text-sm">{l.canal === "email" ? "E-mail" : l.canal === "whatsapp" ? "WhatsApp" : "—"}</Td>
                        <Td>
                          <Badge variante={st.tom}>{st.rotulo}</Badge>
                          {envio?.erro && envio.status !== "enviado" ? <span className="mt-0.5 block text-xs text-muted-foreground">{envio.erro}</span> : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nada enviado ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
