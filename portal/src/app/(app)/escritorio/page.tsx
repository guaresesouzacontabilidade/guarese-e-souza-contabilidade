import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarCheck, FileInput, ListChecks, MessagesSquare } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progresso } from "@/components/ui/feedback";
import { competenciaAtual, hojeISO, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { STATUS_COMPETENCIA } from "@/lib/rotulos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { telaPronta } from "@/components/layout/navegacao";

export const metadata: Metadata = { title: "Visão geral da carteira" };

export default async function VisaoGeralEscritorio() {
  const s = await exigirEquipe();
  const hoje = hojeISO();
  const comp = somarMeses(competenciaAtual(), -1);

  const [empresas, itens, fila, correcoes, aposFechamento, naoAplica, conversas, competencias] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase.from("empresas").select("id, razao_social, nome_fantasia, contador_responsavel_id").eq("ativa", true).order("razao_social").range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase.from("checklist_itens").select("empresa_id, status, obrigatorio, prazo, competencia").gte("competencia", somarMeses(comp, -2)).range(de, ate),
    ),
    s.supabase
      .from("documentos")
      .select("id, empresa_id, nome_original, titulo, enviado_em, status", { count: "exact" })
      .eq("direcao", "cliente")
      .eq("upload_status", "concluido")
      .is("excluido_em", null)
      .is("zip_origem_id", null)
      .in("status", ["recebido", "em_analise"])
      .order("enviado_em")
      .limit(8),
    s.supabase.from("documentos").select("id", { count: "exact", head: true }).eq("status", "correcao").is("excluido_em", null),
    s.supabase.from("documentos").select("id", { count: "exact", head: true }).eq("recebido_apos_fechamento", true).is("apos_fechamento_avaliado_em", null).is("excluido_em", null),
    s.supabase.from("checklist_itens").select("id", { count: "exact", head: true }).eq("status", "nao_se_aplica_solicitado"),
    s.supabase
      .from("conversas")
      .select("id, empresa_id, assunto, ultima_mensagem_em", { count: "exact" })
      .eq("status", "aberta")
      .eq("aguardando", "escritorio")
      .order("ultima_mensagem_em")
      .limit(6),
    s.supabase.from("competencias").select("empresa_id, status").eq("competencia", comp),
  ]);

  const nomes = new Map(empresas.map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));
  // Entrega da competência de trabalho e atrasos (todas as competências recentes)
  const entrega = new Map<string, { total: number; ok: number; atrasados: number }>();
  let atrasadosTotal = 0;
  for (const i of itens) {
    const e = entrega.get(i.empresa_id) ?? { total: 0, ok: 0, atrasados: 0 };
    if (i.competencia === comp && i.obrigatorio) {
      e.total++;
      if (i.status === "concluido" || i.status === "nao_se_aplica") e.ok++;
    }
    if ((i.status === "pendente" || i.status === "correcao") && i.prazo < hoje) {
      e.atrasados++;
      atrasadosTotal++;
    }
    entrega.set(i.empresa_id, e);
  }
  const comChecklist = empresas.filter((e) => (entrega.get(e.id)?.total ?? 0) > 0);
  const completas = comChecklist.filter((e) => {
    const x = entrega.get(e.id)!;
    return x.ok === x.total;
  }).length;
  const percentualCarteira = comChecklist.length ? Math.round((100 * completas) / comChecklist.length) : null;
  const maisAtrasadas = empresas
    .map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social, ...(entrega.get(e.id) ?? { total: 0, ok: 0, atrasados: 0 }) }))
    .filter((e) => e.atrasados > 0)
    .sort((a, b) => b.atrasados - a.atrasados)
    .slice(0, 6);
  const minhas = empresas.filter((e) => e.contador_responsavel_id === s.usuarioId);
  const statusComp = new Map((competencias.data ?? []).map((c) => [c.empresa_id, c.status]));
  const fechadas = [...statusComp.values()].filter((v) => v === "fechada").length;
  const emFechamento = [...statusComp.values()].filter((v) => v === "em_fechamento").length;

  return (
    <>
      <CabecalhoPagina titulo="Visão geral da carteira" descricao={`Situação das empresas atendidas · competência de trabalho: ${formatarCompetencia(comp, true)}`} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Indicador rotulo="Empresas ativas" valor={empresas.length} icone={Building2} href="/escritorio/empresas" />
        <Indicador rotulo="Documentos a conferir" valor={fila.count ?? 0} icone={FileInput} tom={(fila.count ?? 0) ? "info" : "neutro"} href="/escritorio/documentos" />
        <Indicador rotulo="Itens atrasados" valor={atrasadosTotal} icone={AlertTriangle} tom={atrasadosTotal ? "perigo" : "neutro"} href="/escritorio/pendencias?situacao=atraso" />
        <Indicador rotulo="“Não se aplica” a revisar" valor={naoAplica.count ?? 0} icone={ListChecks} tom={(naoAplica.count ?? 0) ? "alerta" : "neutro"} href="/escritorio/pendencias?situacao=conferir" />
        <Indicador rotulo="Mensagens aguardando" valor={conversas.count ?? 0} icone={MessagesSquare} tom={(conversas.count ?? 0) ? "alerta" : "neutro"} href="/escritorio/mensagens" />
        <Indicador
          rotulo="Após fechamento"
          valor={aposFechamento.count ?? 0}
          detalhe="documentos sem avaliação"
          tom={(aposFechamento.count ?? 0) ? "alerta" : "neutro"}
          href="/escritorio/documentos?situacao=todas&fechamento=1"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4" /> Entrega de documentos — {formatarCompetencia(comp, true)}
            </CardTitle>
            <CardDescription>Empresas com todos os itens obrigatórios concluídos ou dispensados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span>{percentualCarteira == null ? "Sem checklist gerado" : `${percentualCarteira}% da carteira completa`}</span>
                <span className="text-muted-foreground">
                  {completas} de {comChecklist.length} empresas
                </span>
              </div>
              <Progresso valor={percentualCarteira} rotulo="Entrega da carteira" />
            </div>
            {maisAtrasadas.length ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mais atrasos</p>
                <ul className="divide-y divide-border text-sm">
                  {maisAtrasadas.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/e/${e.id}/pendencias`} className="min-w-0 truncate hover:underline">
                        {e.nome}
                      </Link>
                      <Badge variante="perigo">{e.atrasados} atrasado(s)</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum item atrasado na carteira.</p>
            )}
            <Link href="/escritorio/pendencias" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Quadro de pendências <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileInput className="size-4" /> Fila de conferência
            </CardTitle>
            <CardDescription>Documentos mais antigos aguardando a equipe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {fila.data?.length ? (
              <ul className="divide-y divide-border text-sm">
                {fila.data.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <Link href={`/e/${d.empresa_id}/documentos/${d.id}`} className="block truncate font-medium hover:underline">
                        {d.titulo ?? d.nome_original}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{nomes.get(d.empresa_id) ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatarRelativo(d.enviado_em)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum documento aguardando conferência.</p>
            )}
            {(correcoes.count ?? 0) > 0 ? <p className="text-xs text-muted-foreground">{correcoes.count} documento(s) aguardam correção pelos clientes.</p> : null}
            <Link href="/escritorio/documentos" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Abrir a fila <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessagesSquare className="size-4" /> Conversas aguardando o escritório
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conversas.data?.length ? (
              <ul className="divide-y divide-border text-sm">
                {conversas.data.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <Link href={`/e/${c.empresa_id}/mensagens/${c.id}`} className="block truncate font-medium hover:underline">
                        {c.assunto}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{nomes.get(c.empresa_id) ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatarDataHora(c.ultima_mensagem_em)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma conversa aguardando resposta.</p>
            )}
            <Link href="/escritorio/mensagens" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Central de mensagens <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="size-4" /> Fechamento de {formatarCompetencia(comp, true)}
            </CardTitle>
            <CardDescription>
              {fechadas} fechada(s) · {emFechamento} em fechamento · {Math.max(0, empresas.length - fechadas - emFechamento)} aberta(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {minhas.length ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresas sob sua responsabilidade</p>
                <ul className="divide-y divide-border text-sm">
                  {minhas.slice(0, 8).map((e) => {
                    const st = statusComp.get(e.id) ?? "aberta";
                    const x = entrega.get(e.id);
                    return (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                        <Link href={`/e/${e.id}`} className="min-w-0 truncate hover:underline">
                          {e.nome_fantasia ?? e.razao_social}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          {x?.total ? <span className="text-xs text-muted-foreground numero">{Math.round((100 * x.ok) / x.total)}%</span> : null}
                          <Badge variante={STATUS_COMPETENCIA[st]?.tom ?? "neutro"}>{STATUS_COMPETENCIA[st]?.rotulo ?? st}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma empresa tem você como responsável. Defina o responsável no cadastro da empresa.</p>
            )}
            {telaPronta("/escritorio/fechamentos") ? (
              <Link href="/escritorio/fechamentos" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Acompanhar fechamentos <ArrowRight className="size-4" />
              </Link>
            ) : null}
            <p className="text-xs text-muted-foreground">Atualizado em {formatarData(hoje)}.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
