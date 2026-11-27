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
import { CancelarCte, CartaCorrecaoCte } from "@/components/cte/acoes-cte";
import { descartarCte, tentarDeNovoCte } from "@/lib/cte-emissao/acoes";
import { CAMPOS_CCE_CTE, CST_ICMS_CTE, EM_ANDAMENTO_CTE, PAPEL_TOMADOR, SITUACAO_CTE, type SituacaoCte } from "@/lib/cte-emissao/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "CT-e" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Totais {
  vTPrest: string;
  vRec: string;
  icms: { grupo: string; cst: string; vBC: string; pICMS: string | null; vICMS: string; vCred: string | null };
  vIBS: string | null;
  vCBS: string | null;
  vTotTrib: string;
}

interface Participante {
  nome: string;
  documento: string;
  endereco: { municipio: string; uf: string };
}

export default async function DetalheCte({ params }: PageProps<"/e/[empresaId]/cte/[id]">) {
  const { empresaId, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("cte.emitir") && !ctx.pode("cte.configurar")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de CT-e desta empresa.</Alerta>;
  const { data: c } = await ctx.supabase
    .from("cte_emissoes")
    .select(
      "id, situacao, ambiente, serie, numero, chave, protocolo, autorizada_em, emitida_em, created_at, valor_total, valor_carga, peso_kg, natureza, tomador_nome, tomador_documento, municipio_inicio, uf_inicio, municipio_fim, uf_fim, nfe_chaves, origem, dados, totais, mensagens, cancelada_em",
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!c) notFound();
  const { data: eventos } = await ctx.supabase
    .from("cte_eventos")
    .select("id, tipo, sequencia, texto, correcoes, situacao, protocolo, registrado_em, mensagens, created_at")
    .eq("emissao_id", id)
    .order("created_at");

  const base = `/e/${empresaId}/cte`;
  const s = SITUACAO_CTE[c.situacao as SituacaoCte];
  const emAndamento = EM_ANDAMENTO_CTE.includes(c.situacao as SituacaoCte) || (eventos ?? []).some((e) => ["na_fila", "enviando"].includes(e.situacao));
  const mensagens = (Array.isArray(c.mensagens) ? c.mensagens : []) as { codigo: string; descricao: string }[];
  const autorizado = ["autorizada", "cancelando", "cancelada"].includes(c.situacao);
  const emitir = ctx.pode("cte.emitir");
  const dados = c.dados as {
    cfop?: string;
    remetente?: Participante;
    destinatario?: Participante;
    tomador?: { papel: number };
    carga?: { produto: string; outras?: string | null };
    componentes?: { nome: string; valor: number }[];
  };
  const t = (c.totais ?? null) as Totais | null;
  const origem = (c.origem ?? null) as { ordem_id?: string; ordem_numero?: number } | null;
  const rotuloCampo = (g: string, k: string) => CAMPOS_CCE_CTE.find((x) => x.grupo === g && x.campo === k)?.rotulo ?? `${g}/${k}`;

  return (
    <>
      <CabecalhoPagina
        titulo={`CT-e nº ${c.numero} (série ${c.serie})`}
        descricao={`${formatarMoeda(c.valor_total)} — ${c.municipio_inicio}/${c.uf_inicio} → ${c.municipio_fim}/${c.uf_fim}`}
        voltar={{ href: base, rotulo: "CT-e (frete)" }}
        acoes={
          <>
            {autorizado ? (
              <>
                <Button asChild>
                  <a href={`/api/cte/${empresaId}/${c.id}?formato=pdf`} target="_blank" rel="noopener noreferrer">
                    <Download /> DACTE (PDF)
                  </a>
                </Button>
                <Button asChild variante="contorno">
                  <a href={`/api/cte/${empresaId}/${c.id}?formato=xml`}>
                    <FileCode2 /> XML
                  </a>
                </Button>
              </>
            ) : null}
            {emitir && c.situacao === "autorizada" ? (
              <>
                <CartaCorrecaoCte empresaId={empresaId} id={c.id} numero={Number(c.numero)} />
                <CancelarCte empresaId={empresaId} id={c.id} numero={Number(c.numero)} autorizadaEm={c.autorizada_em} />
              </>
            ) : null}
            {emitir && c.situacao === "falha" ? (
              <BotaoAcao acao={tentarDeNovoCte.bind(null, empresaId, c.id)} variante="contorno">
                <RotateCcw /> Tentar de novo
              </BotaoAcao>
            ) : null}
            {emitir && c.situacao === "rejeitada" ? (
              <>
                <Button asChild>
                  <Link href={`${base}/nova?corrigir=${c.id}`}>
                    <PencilLine /> Corrigir e enviar de novo
                  </Link>
                </Button>
                <BotaoAcao
                  acao={descartarCte.bind(null, empresaId, c.id)}
                  variante="fantasma"
                  confirmar={{
                    titulo: "Descartar este CT-e?",
                    descricao: `O CT-e nº ${c.numero} não será corrigido. O número fica sem uso e precisa ser inutilizado na SEFAZ (o escritório cuida disso).`,
                    textoConfirmar: "Descartar",
                    perigo: true,
                  }}
                >
                  <Trash2 /> Descartar
                </BotaoAcao>
              </>
            ) : null}
            {emitir && ["autorizada", "cancelada", "descartada"].includes(c.situacao) ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/nova?copiar=${c.id}`}>
                  <Copy /> Novo CT-e com estes dados
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
        {c.ambiente === "homologacao" ? <span className="block">CT-e de teste (homologação): sem valor fiscal.</span> : null}
      </Alerta>

      {mensagens.length ? (
        <Alerta tom={c.situacao === "autorizada" ? "alerta" : "perigo"} className="mb-4" titulo={c.situacao === "autorizada" ? "O cancelamento não foi aceito" : "Motivo"}>
          <ul className="list-disc space-y-1 pl-4">
            {mensagens.map((m, i) => (
              <li key={i}>
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
            <CardTitle>Dados do CT-e</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Situação</dt>
              <dd>
                <Badge variante={s.tom}>{s.rotulo}</Badge>
                {c.ambiente === "homologacao" ? (
                  <Badge variante="contorno" className="ml-1">
                    teste
                  </Badge>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Natureza</dt>
              <dd>
                {dados.cfop ? `${dados.cfop} — ` : ""}
                {c.natureza}
              </dd>
              {dados.remetente ? (
                <>
                  <dt className="text-muted-foreground">Remetente</dt>
                  <dd>
                    {dados.remetente.nome}
                    <span className="block text-xs text-muted-foreground">
                      {formatarDocumento(dados.remetente.documento)} — {dados.remetente.endereco.municipio}/{dados.remetente.endereco.uf}
                    </span>
                  </dd>
                </>
              ) : null}
              {dados.destinatario ? (
                <>
                  <dt className="text-muted-foreground">Destinatário</dt>
                  <dd>
                    {dados.destinatario.nome}
                    <span className="block text-xs text-muted-foreground">
                      {formatarDocumento(dados.destinatario.documento)} — {dados.destinatario.endereco.municipio}/{dados.destinatario.endereco.uf}
                    </span>
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Quem paga</dt>
              <dd>
                {c.tomador_nome}
                <span className="block text-xs text-muted-foreground">
                  {PAPEL_TOMADOR[String(dados.tomador?.papel ?? "")] ?? ""} — {formatarDocumento(c.tomador_documento)}
                </span>
              </dd>
              {origem?.ordem_id ? (
                <>
                  <dt className="text-muted-foreground">Ordem</dt>
                  <dd>
                    <Link href={`/e/${empresaId}/loja/carregamentos/${origem.ordem_id}`} className="underline">
                      Ordem de carregamento nº {origem.ordem_numero}
                    </Link>
                  </dd>
                </>
              ) : null}
              {c.chave ? (
                <>
                  <dt className="text-muted-foreground">Chave de acesso</dt>
                  <dd className="break-all font-mono text-xs">{c.chave}</dd>
                </>
              ) : null}
              {c.protocolo ? (
                <>
                  <dt className="text-muted-foreground">Autorização</dt>
                  <dd>
                    protocolo {c.protocolo}
                    {c.autorizada_em ? ` em ${formatarDataHora(c.autorizada_em)}` : ""}
                  </dd>
                </>
              ) : null}
              {c.cancelada_em ? (
                <>
                  <dt className="text-muted-foreground">Cancelado em</dt>
                  <dd>{formatarDataHora(c.cancelada_em)}</dd>
                </>
              ) : null}
            </dl>
            {c.chave && c.ambiente === "producao" ? (
              <Button asChild variante="link" className="mt-3">
                <a href="https://www.cte.fazenda.gov.br/portal/consultaRecaptcha.aspx" target="_blank" rel="noopener noreferrer">
                  Conferir no Portal Nacional do CT-e <ExternalLink />
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Carga e valores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {dados.carga?.produto}
              {dados.carga?.outras ? ` (${dados.carga.outras})` : ""}
              {c.peso_kg != null ? ` — ${Number(c.peso_kg).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} kg` : ""}
              {c.valor_carga != null ? ` — carga de ${formatarMoeda(c.valor_carga)}` : ""}
            </p>
            <div>
              <p className="text-muted-foreground">NF-e transportadas</p>
              <ul className="break-all font-mono text-xs">
                {(c.nfe_chaves ?? []).map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {(dados.componentes ?? []).map((cp) => (
                <div key={cp.nome} className="contents">
                  <dt className="text-muted-foreground">{cp.nome}</dt>
                  <dd className="text-right numero">{formatarMoeda(cp.valor)}</dd>
                </div>
              ))}
              {t ? (
                <>
                  <dt className="text-muted-foreground">ICMS ({CST_ICMS_CTE[t.icms.grupo === "ICMSSN" ? "sn" : t.icms.cst] ?? t.icms.cst})</dt>
                  <dd className="text-right numero">{formatarMoeda(t.icms.vICMS)}</dd>
                  {t.icms.vCred ? (
                    <>
                      <dt className="text-muted-foreground">Crédito presumido</dt>
                      <dd className="text-right numero">{formatarMoeda(t.icms.vCred)}</dd>
                    </>
                  ) : null}
                  {t.vIBS ? (
                    <>
                      <dt className="text-muted-foreground">IBS (teste 2026)</dt>
                      <dd className="text-right numero">{formatarMoeda(t.vIBS)}</dd>
                    </>
                  ) : null}
                  {t.vCBS ? (
                    <>
                      <dt className="text-muted-foreground">CBS (teste 2026)</dt>
                      <dd className="text-right numero">{formatarMoeda(t.vCBS)}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
              <dt className="font-semibold">Valor do frete</dt>
              <dd className="text-right font-semibold numero">{formatarMoeda(c.valor_total)}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

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
                  {Array.isArray(e.correcoes) ? (
                    <ul className="mt-1 list-disc pl-4">
                      {(e.correcoes as { grupo: string; campo: string; valor: string }[]).map((k, i) => (
                        <li key={i}>
                          {rotuloCampo(k.grupo, k.campo)}: {k.valor}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 whitespace-pre-line">{e.texto}</p>
                  )}
                  {Array.isArray(e.mensagens) && e.mensagens.length ? (
                    <p className="mt-1 text-perigo">
                      {(e.mensagens as { codigo: string; descricao: string }[]).map((m) => `${m.descricao}${m.codigo && m.codigo !== "PORTAL" ? ` (código ${m.codigo})` : ""}`).join("; ")}
                    </p>
                  ) : null}
                  {e.situacao === "registrado" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Protocolo {e.protocolo} {e.registrado_em ? `em ${formatarDataHora(e.registrado_em)}` : ""} —{" "}
                      <a className="underline" href={`/api/cte/${empresaId}/${c.id}?formato=evento&evento=${e.id}`}>
                        XML do evento
                      </a>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
