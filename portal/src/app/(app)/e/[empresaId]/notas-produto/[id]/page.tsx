import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, Download, ExternalLink, FileCode2, Loader2, PencilLine, RotateCcw, Trash2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoAcao } from "@/components/ui/acao";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { CancelarNfe, CartaCorrecaoNfe } from "@/components/nfe/acoes-nota";
import { GuiasNota, type GuiaNota } from "@/components/nfe/guias-nota";
import { descartarNota, tentarDeNovo } from "@/lib/nfe-emissao/acoes";
import { EM_ANDAMENTO, EXPLICACAO_ERRO, MODALIDADE_FRETE, SITUACAO_NFE, type SituacaoNfe } from "@/lib/nfe-emissao/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "NF-e" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Totais {
  vProd: string;
  vFrete: string;
  vDesc: string;
  vICMS: string;
  vICMSUFDest: string;
  vFCPUFDest: string;
  vPIS: string;
  vCOFINS: string;
  vIBS: string | null;
  vCBS: string | null;
  vNF: string;
  icmsFrete: { base: string; aliquota: string; valor: string } | null;
  funrural: { percentual: string; valor: string; modo: string } | null;
  contribuicoes: { nome: string; valor: string }[];
  pesoKg: string | null;
}

export default async function DetalheNfe({ params }: PageProps<"/e/[empresaId]/notas-produto/[id]">) {
  const { empresaId, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfe.emitir") && !ctx.pode("nfe.configurar")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de NF-e desta empresa.</Alerta>;
  const { data: n } = await ctx.supabase
    .from("nfe_emissoes")
    .select(
      "id, situacao, ambiente, serie, numero, chave, protocolo, autorizada_em, emitida_em, created_at, valor_total, natureza, destinatario_nome, destinatario_documento, destinatario_uf, dados, totais, mensagens, tentativas, cancelada_em, descartada_em, email_destinatario_enviado_em",
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!n) notFound();
  const [{ data: eventos }, { data: guias }] = await Promise.all([
    ctx.supabase.from("nfe_eventos").select("id, tipo, sequencia, texto, situacao, protocolo, registrado_em, mensagens, created_at").eq("emissao_id", id).order("created_at"),
    ctx.supabase.from("nfe_guias").select("id, tipo, descricao, uf, codigo_receita, valor, vencimento, situacao, documento_id, observacao").eq("emissao_id", id).order("created_at"),
  ]);
  const docs = (guias ?? []).map((g) => g.documento_id).filter((x): x is string => Boolean(x));
  const { data: pagas } = docs.length ? await ctx.supabase.from("guia_pagamentos").select("guia_documento_id").in("guia_documento_id", docs) : { data: [] };
  const pagasSet = new Set((pagas ?? []).map((p) => p.guia_documento_id));

  const base = `/e/${empresaId}/notas-produto`;
  const s = SITUACAO_NFE[n.situacao as SituacaoNfe];
  const emAndamento = EM_ANDAMENTO.includes(n.situacao as SituacaoNfe) || (eventos ?? []).some((e) => ["na_fila", "enviando"].includes(e.situacao));
  const mensagens = (Array.isArray(n.mensagens) ? n.mensagens : []) as { codigo: string; descricao: string }[];
  const autorizada = ["autorizada", "cancelando", "cancelada"].includes(n.situacao);
  const emitir = ctx.pode("nfe.emitir");
  const dados = n.dados as { emitente?: { endereco?: { uf?: string } }; itens?: { descricao: string; quantidade: string; unidade: string; valorUnitario: string; cfop: string }[]; transporte?: { modalidade?: number; veiculo?: { placa?: string } | null } };
  const t = (n.totais ?? null) as Totais | null;
  const ufEmitente = dados.emitente?.endereco?.uf ?? "";
  const eventosRegistrados = (eventos ?? []).filter((e) => e.situacao === "registrado");

  return (
    <>
      <CabecalhoPagina
        titulo={`NF-e nº ${n.numero} (série ${n.serie})`}
        descricao={`${formatarMoeda(n.valor_total)} — ${n.destinatario_nome}`}
        voltar={{ href: base, rotulo: "Notas de produto" }}
        acoes={
          <>
            {autorizada ? (
              <>
                <Button asChild>
                  <a href={`/api/nfe/${empresaId}/${n.id}?formato=pdf`} target="_blank" rel="noopener noreferrer">
                    <Download /> DANFE (PDF)
                  </a>
                </Button>
                <Button asChild variante="contorno">
                  <a href={`/api/nfe/${empresaId}/${n.id}?formato=xml`}>
                    <FileCode2 /> XML
                  </a>
                </Button>
              </>
            ) : null}
            {emitir && n.situacao === "autorizada" ? (
              <>
                <CartaCorrecaoNfe empresaId={empresaId} id={n.id} numero={Number(n.numero)} />
                <CancelarNfe empresaId={empresaId} id={n.id} numero={Number(n.numero)} autorizadaEm={n.autorizada_em} />
              </>
            ) : null}
            {emitir && (n.situacao === "falha" || n.situacao === "aguardando") ? (
              <BotaoAcao acao={tentarDeNovo.bind(null, empresaId, n.id)} variante="contorno">
                <RotateCcw /> Tentar de novo
              </BotaoAcao>
            ) : null}
            {emitir && n.situacao === "rejeitada" ? (
              <>
                <Button asChild>
                  <Link href={`${base}/nova?corrigir=${n.id}`}>
                    <PencilLine /> Corrigir e enviar de novo
                  </Link>
                </Button>
                <BotaoAcao
                  acao={descartarNota.bind(null, empresaId, n.id)}
                  variante="fantasma"
                  confirmar={{
                    titulo: "Descartar esta nota?",
                    descricao: `A nota nº ${n.numero} não será corrigida. O número fica sem uso e precisa ser inutilizado na SEFAZ (o escritório cuida disso).`,
                    textoConfirmar: "Descartar",
                    perigo: true,
                  }}
                >
                  <Trash2 /> Descartar
                </BotaoAcao>
              </>
            ) : null}
            {emitir && ["autorizada", "cancelada", "descartada"].includes(n.situacao) ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/nova?copiar=${n.id}`}>
                  <Copy /> Nova nota com estes dados
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AtualizarEnquanto ativo={emAndamento} intervaloMs={2000} limiteMs={180_000} />

      <Alerta tom={s.tom === "neutro" ? "info" : s.tom} className="mb-4" titulo={s.rotulo}>
        <span className="inline-flex items-center gap-2">
          {emAndamento ? <Loader2 className="size-4 animate-spin" /> : null}
          {s.ajuda}
        </span>
        {n.ambiente === "homologacao" ? <span className="block">Nota de teste (homologação): sem valor fiscal.</span> : null}
      </Alerta>

      {mensagens.length ? (
        <Alerta tom={n.situacao === "autorizada" ? "alerta" : "perigo"} className="mb-4" titulo={n.situacao === "autorizada" ? "O cancelamento não foi aceito" : "Motivo"}>
          <ul className="list-disc space-y-1 pl-4">
            {mensagens.map((m, i) => (
              <li key={i}>
                {EXPLICACAO_ERRO[m.codigo] ? <strong>{EXPLICACAO_ERRO[m.codigo]} </strong> : null}
                {m.descricao}
                {m.codigo && m.codigo !== "PORTAL" ? <span className="text-xs opacity-80"> — código {m.codigo}</span> : null}
              </li>
            ))}
          </ul>
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Dados da nota</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Situação</dt>
              <dd>
                <Badge variante={s.tom}>{s.rotulo}</Badge>
                {n.ambiente === "homologacao" ? (
                  <Badge variante="contorno" className="ml-1">
                    teste
                  </Badge>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Natureza</dt>
              <dd>{n.natureza}</dd>
              <dt className="text-muted-foreground">Cliente</dt>
              <dd>
                {n.destinatario_nome}
                <span className="block text-xs text-muted-foreground">
                  {formatarDocumento(n.destinatario_documento)}
                  {n.destinatario_uf ? ` — ${n.destinatario_uf}` : ""}
                </span>
              </dd>
              <dt className="text-muted-foreground">Frete</dt>
              <dd>
                {MODALIDADE_FRETE[(dados.transporte?.modalidade ?? 9) as keyof typeof MODALIDADE_FRETE]}
                {dados.transporte?.veiculo?.placa ? ` — placa ${dados.transporte.veiculo.placa}` : ""}
              </dd>
              {n.chave ? (
                <>
                  <dt className="text-muted-foreground">Chave de acesso</dt>
                  <dd className="break-all font-mono text-xs">{n.chave}</dd>
                </>
              ) : null}
              {n.protocolo ? (
                <>
                  <dt className="text-muted-foreground">Autorização</dt>
                  <dd>
                    protocolo {n.protocolo}
                    {n.autorizada_em ? ` em ${formatarDataHora(n.autorizada_em)}` : ""}
                  </dd>
                </>
              ) : null}
              {n.cancelada_em ? (
                <>
                  <dt className="text-muted-foreground">Cancelada em</dt>
                  <dd>{formatarDataHora(n.cancelada_em)}</dd>
                </>
              ) : null}
              {n.email_destinatario_enviado_em ? (
                <>
                  <dt className="text-muted-foreground">E-mail ao cliente</dt>
                  <dd>enviado em {formatarDataHora(n.email_destinatario_enviado_em)}</dd>
                </>
              ) : null}
            </dl>
            {n.chave && n.ambiente === "producao" ? (
              <Button asChild variante="link" className="mt-3">
                <a href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo" target="_blank" rel="noopener noreferrer">
                  Conferir no Portal Nacional da NF-e <ExternalLink />
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Produtos e valores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1">
              {(dados.itens ?? []).map((i, k) => (
                <li key={k} className="flex justify-between gap-3">
                  <span>
                    {i.descricao} <span className="text-muted-foreground">— {Number(i.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {i.unidade} × {formatarMoeda(i.valorUnitario)} (CFOP {i.cfop})</span>
                  </span>
                </li>
              ))}
            </ul>
            {t ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {(
                  [
                    ["Produtos", t.vProd],
                    ["Frete na nota", t.vFrete],
                    ["Desconto", t.vDesc],
                    ["ICMS", t.vICMS],
                    ["DIFAL (destino)", t.vICMSUFDest],
                    ["FCP (destino)", t.vFCPUFDest],
                    ["PIS", t.vPIS],
                    ["COFINS", t.vCOFINS],
                    ["IBS (teste 2026)", t.vIBS],
                    ["CBS (teste 2026)", t.vCBS],
                    ["ICMS do frete (retido)", t.icmsFrete?.valor ?? null],
                    ["FUNRURAL", t.funrural?.valor ?? null],
                    ...t.contribuicoes.map((c) => [c.nome, c.valor] as const),
                  ] as const
                )
                  .filter(([, v]) => v != null && v !== "0.00")
                  .map(([r, v]) => (
                    <div key={r} className="contents">
                      <dt className="text-muted-foreground">{r}</dt>
                      <dd className="text-right numero">{formatarMoeda(v!)}</dd>
                    </div>
                  ))}
                <dt className="font-semibold">Total da nota</dt>
                <dd className="text-right font-semibold numero">{formatarMoeda(t.vNF)}</dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">Os valores aparecem quando a nota é montada para o envio.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {guias?.length && n.chave ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Guias desta nota</CardTitle>
          </CardHeader>
          <CardContent>
            <GuiasNota
              empresaId={empresaId}
              chave={n.chave}
              ufEmitente={ufEmitente}
              numeroNota={Number(n.numero)}
              escritorio={ctx.pode("nfe.configurar")}
              teste={n.ambiente === "homologacao"}
              guias={(guias ?? []).map((g) => ({ ...g, valor: Number(g.valor), situacao: g.situacao as GuiaNota["situacao"], paga: Boolean(g.documento_id && pagasSet.has(g.documento_id)) }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {eventos?.length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Cancelamento e cartas de correção</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {eventos.map((e) => (
                <li key={e.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{e.tipo === "cancelamento" ? "Cancelamento" : `Carta de correção nº ${e.sequencia}`}</span>
                    <Badge variante={e.situacao === "registrado" ? "sucesso" : e.situacao === "rejeitado" ? "perigo" : "info"}>
                      {e.situacao === "registrado" ? "Registrado na SEFAZ" : e.situacao === "rejeitado" ? "Não aceito" : e.situacao === "falha" ? "Sem resposta" : "Enviando"}
                    </Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-line">{e.texto}</p>
                  {Array.isArray(e.mensagens) && e.mensagens.length ? (
                    <p className="mt-1 text-perigo">
                      {(e.mensagens as { codigo: string; descricao: string }[]).map((m) => `${m.descricao}${m.codigo && m.codigo !== "PORTAL" ? ` (código ${m.codigo})` : ""}`).join("; ")}
                    </p>
                  ) : null}
                  {e.situacao === "registrado" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Protocolo {e.protocolo} {e.registrado_em ? `em ${formatarDataHora(e.registrado_em)}` : ""} —{" "}
                      <a className="underline" href={`/api/nfe/${empresaId}/${n.id}?formato=evento&evento=${e.id}`}>
                        XML do evento
                      </a>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {eventosRegistrados.some((e) => e.tipo === "carta_correcao") ? (
              <p className="mt-2 text-xs text-muted-foreground">A carta de correção mais recente substitui as anteriores e acompanha o DANFE.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
