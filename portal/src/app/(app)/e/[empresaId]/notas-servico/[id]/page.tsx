import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, Download, ExternalLink, FileCode2, Loader2, RotateCcw } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoAcao } from "@/components/ui/acao";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { CancelarNota } from "@/components/nfse/cancelar-nota";
import { tentarDeNovo } from "@/lib/nfse-emissao/acoes";
import { EM_ANDAMENTO, EXPLICACAO_ERRO, MOTIVOS_CANCELAMENTO, SITUACAO_NFSE, TOMADOR_TIPO, type SituacaoNfse } from "@/lib/nfse-emissao/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Nota de serviço" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DetalheNota({ params }: PageProps<"/e/[empresaId]/notas-servico/[id]">) {
  const { empresaId, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfse.emitir") && !ctx.pode("nfse.configurar")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de notas desta empresa.</Alerta>;
  const { data: n } = await ctx.supabase
    .from("nfse_emissoes")
    .select(
      "id, situacao, ambiente, serie, numero_dps, competencia, numero_nfse, chave_acesso, autorizada_em, valor, descricao, iss_retido, aliquota_iss, tomador_tipo, tomador_documento, tomador_nome, tomador_email, local_prestacao, codigo_tributacao_nacional, mensagens, tentativas, created_at, cancelamento_motivo, cancelamento_justificativa, cancelada_em, email_tomador_enviado_em, servico:nfse_servicos(nome)",
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!n) notFound();
  const base = `/e/${empresaId}/notas-servico`;
  const s = SITUACAO_NFSE[n.situacao as SituacaoNfse];
  const emAndamento = EM_ANDAMENTO.includes(n.situacao as SituacaoNfse);
  const mensagens = (Array.isArray(n.mensagens) ? n.mensagens : []) as { codigo: string; descricao: string; complemento?: string | null }[];
  const temXml = ["autorizada", "cancelando", "cancelada"].includes(n.situacao);
  const emitir = ctx.pode("nfse.emitir");
  const servico = n.servico as { nome: string } | null;

  return (
    <>
      <CabecalhoPagina
        titulo={n.numero_nfse ? `NFS-e nº ${n.numero_nfse}` : `Nota de serviço (DPS ${n.numero_dps})`}
        descricao={`${formatarMoeda(n.valor)} — ${n.tomador_tipo === "nao_identificado" ? "tomador não identificado" : n.tomador_nome}`}
        voltar={{ href: base, rotulo: "Notas de serviço" }}
        acoes={
          <>
            {temXml ? (
              <>
                <Button asChild>
                  <a href={`/api/nfse/${empresaId}/${n.id}?formato=pdf`}>
                    <Download /> PDF (DANFSe)
                  </a>
                </Button>
                <Button asChild variante="contorno">
                  <a href={`/api/nfse/${empresaId}/${n.id}?formato=xml`}>
                    <FileCode2 /> XML
                  </a>
                </Button>
              </>
            ) : null}
            {emitir && n.situacao === "autorizada" ? <CancelarNota empresaId={empresaId} id={n.id} numero={n.numero_nfse} /> : null}
            {emitir && n.situacao === "falha" ? (
              <BotaoAcao acao={tentarDeNovo.bind(null, empresaId, n.id)} variante="contorno">
                <RotateCcw /> Tentar de novo
              </BotaoAcao>
            ) : null}
            {emitir && (n.situacao === "rejeitada" || n.situacao === "cancelada") ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/nova?copiar=${n.id}`}>
                  <Copy /> Pedir de novo com estes dados
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AtualizarEnquanto ativo={emAndamento} intervaloMs={2000} limiteMs={120_000} />

      <Alerta tom={s.tom === "neutro" ? "info" : s.tom} className="mb-4" titulo={s.rotulo}>
        <span className="inline-flex items-center gap-2">
          {emAndamento ? <Loader2 className="size-4 animate-spin" /> : null}
          {s.ajuda}
        </span>
        {n.ambiente === "homologacao" ? <span className="block">Nota de teste (produção restrita): sem validade jurídica.</span> : null}
      </Alerta>

      {mensagens.length ? (
        <Alerta tom={n.situacao === "autorizada" ? "alerta" : "perigo"} className="mb-4" titulo={n.situacao === "autorizada" ? "O cancelamento não foi aceito" : "Motivo"}>
          <ul className="list-disc space-y-1 pl-4">
            {mensagens.map((m, i) => (
              <li key={i}>
                {EXPLICACAO_ERRO[m.codigo] ? <strong>{EXPLICACAO_ERRO[m.codigo]} </strong> : null}
                {m.descricao}
                {m.complemento ? ` (${m.complemento})` : ""}
                {m.codigo && m.codigo !== "—" && m.codigo !== "PORTAL" ? <span className="text-xs opacity-80"> — código {m.codigo}</span> : null}
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
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="font-semibold numero">{formatarMoeda(n.valor)}</dd>
              <dt className="text-muted-foreground">Serviço</dt>
              <dd>
                {servico?.nome ?? "—"} ({n.codigo_tributacao_nacional})
              </dd>
              <dt className="text-muted-foreground">Data da prestação</dt>
              <dd>{formatarData(n.competencia)}</dd>
              <dt className="text-muted-foreground">ISS</dt>
              <dd>{n.iss_retido ? `Retido pelo tomador (${String(n.aliquota_iss).replace(".", ",")}%)` : "Não retido"}</dd>
              <dt className="text-muted-foreground">DPS</dt>
              <dd className="numero">
                série {n.serie}, nº {n.numero_dps}
              </dd>
              {n.chave_acesso ? (
                <>
                  <dt className="text-muted-foreground">Chave de acesso</dt>
                  <dd className="break-all font-mono text-xs">{n.chave_acesso}</dd>
                  <dt className="text-muted-foreground">Emitida em</dt>
                  <dd>{n.autorizada_em ? formatarDataHora(n.autorizada_em) : "—"}</dd>
                </>
              ) : null}
              {n.situacao === "cancelada" ? (
                <>
                  <dt className="text-muted-foreground">Cancelada em</dt>
                  <dd>
                    {n.cancelada_em ? formatarDataHora(n.cancelada_em) : "—"} —{" "}
                    {MOTIVOS_CANCELAMENTO[n.cancelamento_motivo as keyof typeof MOTIVOS_CANCELAMENTO] ?? ""}: {n.cancelamento_justificativa}
                  </dd>
                </>
              ) : null}
            </dl>
            {n.chave_acesso && n.ambiente === "producao" ? (
              <Button asChild variante="link" className="mt-3">
                <a href={`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${n.chave_acesso}`} target="_blank" rel="noopener noreferrer">
                  Conferir no portal nacional da NFS-e <ExternalLink />
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tomador e serviço</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Tomador</dt>
              <dd>
                {n.tomador_tipo === "nao_identificado" ? TOMADOR_TIPO.nao_identificado : `${n.tomador_nome} — ${formatarDocumento(n.tomador_documento)}`}
              </dd>
              {n.tomador_email ? (
                <>
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd>
                    {n.tomador_email}
                    {n.email_tomador_enviado_em ? <span className="block text-xs text-muted-foreground">Nota enviada por e-mail em {formatarDataHora(n.email_tomador_enviado_em)}</span> : null}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Descrição</dt>
              <dd className="whitespace-pre-line">{n.descricao}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
