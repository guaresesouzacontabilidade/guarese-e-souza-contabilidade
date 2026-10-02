import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoPaguei, DesfazerPagamento } from "@/components/agenda/paguei";
import { calcularPrevisao, type DadosPrevisao } from "@/lib/calculos/previsao";
import { competenciaAtual, hojeISO, lerCompetencia, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Agenda de pagamentos" };

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function diaSemana(data: string) {
  return DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()];
}

interface Guia {
  id: string;
  titulo: string;
  competencia: string;
  vencimento: string;
  valor: number | null;
  pagamento: { pago_em: string; valor_pago: number | null; comprovante_documento_id: string | null } | null;
}

export default async function AgendaPagamentos({ params, searchParams }: PageProps<"/e/[empresaId]/agenda">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.ver")) return <Alerta tom="alerta">Seu acesso não inclui os documentos desta empresa.</Alerta>;
  const hoje = hojeISO();
  const mes = lerCompetencia(parametro(sp, "mes")) ?? competenciaAtual();
  const fimMes = ultimoDiaDoMes(mes);
  const base = `/e/${empresaId}`;
  const podePagar = ctx.pode("documentos.enviar");

  const [guiasRes, itensRes, previsaoRes] = await Promise.all([
    ctx.supabase
      .from("documentos")
      .select("id, titulo, nome_original, competencia, vencimento, valor, pagamento:guia_pagamentos!guia_pagamentos_guia_fk(pago_em, valor_pago, comprovante_documento_id)")
      .eq("empresa_id", empresaId)
      .eq("direcao", "escritorio")
      .eq("categoria_codigo", "esc_guia")
      .not("publicado_em", "is", null)
      .is("excluido_em", null)
      .not("vencimento", "is", null)
      .gte("vencimento", somarMeses(mes, -6))
      .lte("vencimento", fimMes)
      .order("vencimento"),
    podePagar
      ? ctx.supabase
          .from("checklist_itens")
          .select("id, competencia")
          .eq("empresa_id", empresaId)
          .eq("categoria_codigo", "guia_imposto")
          .in("status", ["pendente", "correcao"])
      : Promise.resolve({ data: [] }),
    ctx.pode("calculos.ver")
      ? ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: somarMeses(mes, -1) })
      : Promise.resolve({ data: null }),
  ]);

  const guias: Guia[] = (guiasRes.data ?? []).map((g) => {
    const pg = (Array.isArray(g.pagamento) ? g.pagamento[0] : g.pagamento) as Guia["pagamento"] | undefined;
    return {
      id: g.id,
      titulo: g.titulo ?? g.nome_original,
      competencia: g.competencia,
      vencimento: g.vencimento as string,
      valor: g.valor == null ? null : Number(g.valor),
      pagamento: pg ? { ...pg, valor_pago: pg.valor_pago == null ? null : Number(pg.valor_pago) } : null,
    };
  });
  const itemPorComp = new Map((itensRes.data ?? []).map((i) => [String(i.competencia).slice(0, 7), i.id]));
  const doMes = guias.filter((g) => g.vencimento >= mes);
  const atrasadas = guias.filter((g) => g.vencimento < mes && !g.pagamento);
  const vencidasNoMes = doMes.filter((g) => !g.pagamento && g.vencimento < hoje);
  const soma = (l: Guia[]) => l.reduce((s, g) => s.plus(dec(g.valor ?? 0)), dec(0));
  const pagas = doMes.filter((g) => g.pagamento);
  const aPagar = doMes.filter((g) => !g.pagamento);

  // Previsão (estimativa) dos impostos que ainda não têm guia publicada
  const previsao = previsaoRes.data ? calcularPrevisao(previsaoRes.data as unknown as DadosPrevisao) : null;
  const previstos =
    previsao && previsao.situacao === "ok" && (ctx.equipe || previsao.checklist.faltantes.length === 0)
      ? previsao.linhas.filter((l) => l.grupo === "pagar" && !l.valorGuia && !l.chave.startsWith("ajuste:") && l.valor.gt(0))
      : [];

  const porDia = new Map<string, Guia[]>();
  for (const g of doMes) porDia.set(g.vencimento, [...(porDia.get(g.vencimento) ?? []), g]);

  const linkMes = (c: string) => `${base}/agenda?mes=${c.slice(0, 7)}`;

  const situacao = (g: Guia) => {
    if (g.pagamento) return <Badge variante="sucesso">Pago em {formatarData(g.pagamento.pago_em)}</Badge>;
    if (g.vencimento < hoje) return <Badge variante="perigo">Vencida</Badge>;
    if (g.vencimento === hoje) return <Badge variante="alerta">Vence hoje</Badge>;
    return <Badge variante="info">A vencer</Badge>;
  };

  const linhaGuia = (g: Guia) => (
    <li key={g.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`${base}/documentos/${g.id}`} className="font-medium hover:underline">
          {g.titulo}
        </Link>
        <span className="block text-xs text-muted-foreground">
          Competência {formatarCompetencia(g.competencia)} · vence {formatarData(g.vencimento)}
          {g.pagamento?.comprovante_documento_id ? " · comprovante enviado" : g.pagamento ? " · sem comprovante" : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="numero font-semibold">{g.valor != null ? formatarMoeda(g.valor) : "—"}</span>
        {situacao(g)}
        <Button asChild variante="contorno" tamanho="sm">
          <Link href={`${base}/documentos/${g.id}`}>
            <FileText /> Guia
          </Link>
        </Button>
        {podePagar && !g.pagamento ? (
          <BotaoPaguei
            empresaId={empresaId}
            guia={{ id: g.id, titulo: g.titulo, competencia: g.competencia, vencimento: g.vencimento, valor: g.valor }}
            itemComprovanteId={itemPorComp.get(g.competencia.slice(0, 7)) ?? null}
          />
        ) : null}
        {podePagar && g.pagamento ? <DesfazerPagamento empresaId={empresaId} guiaId={g.id} /> : null}
      </div>
    </li>
  );

  return (
    <>
      <CabecalhoPagina
        titulo="Agenda de pagamentos"
        descricao="As guias do mês publicadas pelo escritório, com vencimento e valor. Depois de pagar, toque em Paguei e anexe o comprovante."
        acoes={
          <div className="flex items-center gap-1">
            <Button asChild variante="contorno" tamanho="icone" aria-label="Mês anterior">
              <Link href={linkMes(somarMeses(mes, -1))}>
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-40 text-center text-sm font-semibold">
              {formatarCompetencia(mes, true).charAt(0).toUpperCase() + formatarCompetencia(mes, true).slice(1)}
            </span>
            <Button asChild variante="contorno" tamanho="icone" aria-label="Próximo mês">
              <Link href={linkMes(somarMeses(mes, 1))}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />

      {atrasadas.length ? (
        <Card className="mb-4 border-perigo/40">
          <CardHeader>
            <CardTitle>Guias de meses anteriores sem pagamento informado</CardTitle>
            <CardDescription>Se já pagou, toque em Paguei. Se não, fale com o escritório sobre juros e multa.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">{atrasadas.map(linhaGuia)}</ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Indicador rotulo={`Guias de ${formatarCompetencia(mes, true)}`} valor={formatarMoeda(soma(doMes))} detalhe={`${doMes.length} guia(s)`} />
        <Indicador rotulo="Pagas" valor={formatarMoeda(soma(pagas))} detalhe={`${pagas.length} guia(s)`} tom="sucesso" />
        <Indicador
          rotulo="A pagar"
          valor={formatarMoeda(soma(aPagar))}
          detalhe={vencidasNoMes.length ? `${vencidasNoMes.length} vencida(s)` : `${aPagar.length} guia(s)`}
          tom={vencidasNoMes.length ? "perigo" : aPagar.length ? "alerta" : "neutro"}
        />
      </div>

      {doMes.length ? (
        <Card>
          <CardContent className="pt-2">
            <ol className="divide-y divide-border">
              {[...porDia.entries()].map(([dia, lista]) => (
                <li key={dia} className="py-2">
                  <p className={`text-sm font-semibold ${dia === hoje ? "text-primary" : "text-titulo"}`}>
                    {formatarData(dia)} <span className="font-normal text-muted-foreground">({diaSemana(dia)})</span>
                    {dia === hoje ? <span className="ml-2 text-xs font-medium">hoje</span> : null}
                  </p>
                  <ul className="divide-y divide-border">{lista.map(linhaGuia)}</ul>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio
          icone={CalendarDays}
          titulo={`Nenhuma guia com vencimento em ${formatarCompetencia(mes, true)}`}
          descricao="As guias aparecem aqui assim que o escritório publicá-las em Meus documentos."
        />
      )}

      {previstos.length && previsao ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Ainda sem guia: previsão (estimativa)</CardTitle>
            <CardDescription>
              Impostos de {formatarCompetencia(previsao.competencia, true)} que vencem em {formatarCompetencia(previsao.mesPagamento, true)}, calculados pelo portal. A guia
              oficial será publicada pelo escritório.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {previstos.map((l) => (
                <li key={l.chave} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.tributo}
                    <span className="block text-xs text-muted-foreground">{l.vencimento ? `vence ${formatarData(l.vencimento)}` : "vencimento conforme a guia"}</span>
                  </span>
                  <span className="numero">~ {formatarMoeda(l.valor)}</span>
                </li>
              ))}
            </ul>
            <Link href={`${base}/calculos?competencia=${previsao.competencia.slice(0, 7)}`} className="mt-2 inline-block text-sm text-primary hover:underline">
              Ver a previsão completa
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
