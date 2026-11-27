import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcoesOs } from "@/components/os/acoes-os";
import { FotosOs } from "@/components/os/fotos-os";
import { RecebimentosOs } from "@/components/os/receber-os";
import type { PessoaOs, ServicoOs } from "@/components/os/form-os";
import { envPublico } from "@/lib/env";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import {
  andamento,
  atrasada,
  AVISO_WHATSAPP,
  faltaReceber,
  ETAPA,
  entregaPrevista,
  execucaoAgora,
  formatarEntrega,
  formatarMinutos,
  linkWhatsApp,
  montarMensagem,
  pausaAgora,
  PRIORIDADE,
  type EtapaOs,
} from "@/lib/os/rotulos";

export const metadata: Metadata = { title: "Ordem de serviço" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const minutosEntre = (de: string | null, ate: string | null) => (de && ate ? Math.max((new Date(ate).getTime() - new Date(de).getTime()) / 60000, 0) : null);

const ROTULO_EVENTO: Record<string, string> = {
  criada: "OS aberta",
  editada: "OS alterada",
  pausa: "Pausada",
  retomada: "Retomada",
  responsavel: "Responsável",
  cancelada: "Cancelada",
  pagamento: "Pagamento",
  estorno: "Estorno",
  foto: "Foto",
  aviso: "WhatsApp",
};

export default async function DetalheOs({ params }: PageProps<"/e/[empresaId]/os/[osId]">) {
  const { empresaId, osId } = await params;
  if (!UUID.test(osId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("os.operar")) return <Alerta tom="alerta">Seu acesso não inclui as ordens de serviço desta empresa.</Alerta>;

  const [{ data: o }, { data: itens }, { data: eventos }, { data: equipe }, { data: servicos }, { data: cfg }, { data: fotos }] = await Promise.all([
    ctx.supabase.from("os_ordens").select("*").eq("id", osId).eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("os_itens").select("*, servico:os_servicos(setor)").eq("ordem_id", osId).order("posicao"),
    ctx.supabase.from("os_eventos").select("*, usuario:perfis(nome)").eq("ordem_id", osId).order("em", { ascending: false }).limit(200),
    ctx.supabase.from("os_equipe").select("id, nome, cor, ativo").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("os_servicos").select("*").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("os_config").select("mensagem_pronta, nome_exibicao, whatsapp_ativo").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("os_fotos").select("id, momento, legenda, mime, enviado_por").eq("ordem_id", osId).not("confirmado_em", "is", null).order("created_at"),
  ]);
  if (!o) notFound();
  const etapa = o.etapa as EtapaOs;
  const agora = new Date().getTime();
  const and = andamento(o, agora);
  const pessoa = (equipe ?? []).find((p) => p.id === o.responsavel_id);
  const link = `${envPublico.siteUrl()}/acompanhar/${o.codigo_publico}`;
  const loja = cfg?.nome_exibicao ?? ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social;
  const whatsapp = linkWhatsApp(o.cliente_telefone, montarMensagem(cfg?.mensagem_pronta, { cliente: o.cliente_nome, numero: o.numero, link, loja }));
  const exec = execucaoAgora(o, agora);
  const entrega = entregaPrevista(o);
  const podeReceber = ctx.acesso.loja && ctx.pode("gestao.vender");
  const fechada = etapa === "entregue" || etapa === "cancelada";
  const aviso = o.aviso_whatsapp ? AVISO_WHATSAPP[o.aviso_whatsapp] : null;
  const tempos = [
    { rotulo: "Na fila", valor: minutosEntre(o.aberta_em, o.iniciada_em ?? (etapa === "fila" ? new Date(agora).toISOString() : null)) },
    { rotulo: "Execução (sem pausas)", valor: o.iniciada_em ? exec : null },
    { rotulo: "Pausas", valor: Number(o.minutos_pausa) || o.pausada ? pausaAgora(o, agora) : null },
    { rotulo: "Pronta esperando retirada", valor: minutosEntre(o.pronta_em, o.entregue_em ?? (etapa === "pronta" ? new Date(agora).toISOString() : null)) },
    { rotulo: "Total (abertura até pronta)", valor: minutosEntre(o.aberta_em, o.pronta_em) },
  ];

  return (
    <>
      <CabecalhoPagina
        titulo={`OS nº ${o.numero} — ${o.cliente_nome}`}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variante={ETAPA[etapa].variante}>{ETAPA[etapa].rotulo}</Badge>
            {o.prioridade !== "normal" ? <Badge variante={PRIORIDADE[o.prioridade]?.variante ?? "neutro"}>{PRIORIDADE[o.prioridade]?.rotulo}</Badge> : null}
            {atrasada(o, agora) ? <Badge variante="perigo">Atrasada</Badge> : null}
            {o.pausada ? <Badge variante="alerta">Pausada: {o.pausa_motivo}</Badge> : null}
            <span>Aberta em {formatarDataHora(o.aberta_em)}</span>
          </span>
        }
        voltar={{ href: `/e/${empresaId}/os`, rotulo: "Esteira de serviços" }}
      />
      <div className="mb-4">
        <AcoesOs
          empresaId={empresaId}
          os={{
            id: o.id,
            numero: o.numero,
            cliente_nome: o.cliente_nome,
            cliente_telefone: o.cliente_telefone,
            cliente_documento: o.cliente_documento,
            descricao: o.descricao,
            observacoes: o.observacoes,
            prioridade: o.prioridade,
            responsavel_id: o.responsavel_id,
            prazo: o.prazo,
            avisar_whatsapp: o.avisar_whatsapp,
            itens: (itens ?? []).map((i) => ({
              servico_id: i.servico_id,
              descricao: i.descricao,
              quantidade: i.quantidade,
              unidade: i.unidade,
              minutos_estimados: i.minutos_estimados,
              valor_unitario: i.valor_unitario,
            })),
          }}
          etapa={etapa}
          pausada={o.pausada}
          responsavelId={o.responsavel_id}
          servicos={(servicos ?? []) as ServicoOs[]}
          equipe={(equipe ?? []) as PessoaOs[]}
          whatsapp={whatsapp}
          linkAcompanhar={link}
          podeGerenciar={ctx.pode("os.gerenciar")}
          podeReceber={podeReceber}
          falta={faltaReceber(o)}
          whatsappAtivo={Boolean(cfg?.whatsapp_ativo)}
        />
      </div>
      {etapa === "cancelada" ? <Alerta tom="perigo" className="mb-4">Cancelada em {formatarDataHora(o.cancelada_em)}: {o.cancelada_motivo}</Alerta> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Serviços</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <THead>
                  <Tr>
                    <Th>Serviço</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">Tempo estimado</Th>
                    <Th className="text-right">Valor</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(itens ?? []).map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        {i.descricao}
                        {(i.servico as { setor?: string | null } | null)?.setor ? <span className="block text-xs text-muted-foreground">{(i.servico as { setor: string }).setor}</span> : null}
                      </Td>
                      <Td className="text-right">
                        {String(i.quantidade).replace(".", ",")} {i.unidade}
                      </Td>
                      <Td className="text-right">{formatarMinutos(i.minutos_estimados)}</Td>
                      <Td className="text-right">{formatarMoeda(Number(i.valor_unitario) * Number(i.quantidade))}</Td>
                    </Tr>
                  ))}
                  <Tr>
                    <Td className="font-semibold">Total</Td>
                    <Td />
                    <Td className="text-right font-semibold">{formatarMinutos(o.minutos_estimados)}</Td>
                    <Td className="text-right font-semibold">{formatarMoeda(o.valor_total)}</Td>
                  </Tr>
                </TBody>
              </Table>
              {o.descricao ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">O que fazer</p>
                  <p className="whitespace-pre-wrap text-sm">{o.descricao}</p>
                </div>
              ) : null}
              {o.observacoes ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Observações internas</p>
                  <p className="whitespace-pre-wrap text-sm">{o.observacoes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Fotos</CardTitle>
            </CardHeader>
            <CardContent>
              <FotosOs
                empresaId={empresaId}
                osId={o.id}
                etapa={etapa}
                podeEnviar={etapa !== "cancelada"}
                fotos={(fotos ?? []).map((f) => ({
                  id: f.id,
                  momento: f.momento,
                  legenda: f.legenda,
                  mime: f.mime,
                  podeExcluir: ctx.pode("os.gerenciar") || (f.enviado_por === ctx.sessao.usuarioId && !fechada),
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {(eventos ?? []).map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-2 border-l-2 border-border pl-3">
                    <span className="font-medium">
                      {e.tipo === "etapa" ? `${ETAPA[(e.de_etapa ?? "fila") as EtapaOs]?.rotulo ?? e.de_etapa} → ${ETAPA[(e.para_etapa ?? "fila") as EtapaOs]?.rotulo ?? e.para_etapa}` : ROTULO_EVENTO[e.tipo] ?? e.tipo}
                    </span>
                    {e.detalhe ? <span className="text-muted-foreground">{e.detalhe}</span> : null}
                    <span className="text-xs text-muted-foreground">
                      {formatarDataHora(e.em)}
                      {(e.usuario as { nome?: string } | null)?.nome ? ` · ${(e.usuario as { nome?: string }).nome}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          {Number(o.valor_total) > 0 || Number(o.valor_recebido) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                <RecebimentosOs empresaId={empresaId} osId={o.id} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Tempos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between">
                  <span>Execução × estimado</span>
                  <strong className={and.situacao === "estourou" ? "text-perigo" : undefined}>
                    {formatarMinutos(exec)} / {formatarMinutos(o.minutos_estimados)}
                  </strong>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={and.situacao === "estourou" ? "h-full bg-perigo" : and.situacao === "perto" ? "h-full bg-alerta" : "h-full bg-sucesso"}
                    style={{ width: `${Math.min(and.percentual, 100)}%` }}
                  />
                </div>
              </div>
              <dl className="space-y-1.5">
                {tempos.map((t) => (
                  <div key={t.rotulo} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t.rotulo}</dt>
                    <dd>{t.valor === null ? "—" : formatarMinutos(t.valor)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cliente e entrega</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p>{o.cliente_nome}</p>
              {o.cliente_telefone ? <p>{formatarTelefone(o.cliente_telefone)}</p> : null}
              {o.cliente_documento ? <p>{formatarDocumento(o.cliente_documento)}</p> : null}
              <p className="pt-2">
                <span className="text-muted-foreground">Responsável:</span> {pessoa?.nome ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">{o.prazo ? "Prazo combinado" : "Previsão"}:</span> {formatarEntrega(entrega)}
              </p>
              {o.prazo && o.previsao ? (
                <p>
                  <span className="text-muted-foreground">Previsão na abertura:</span> {formatarEntrega(o.previsao)}
                </p>
              ) : null}
              {aviso ? (
                <p className={aviso.tom === "perigo" ? "text-perigo" : aviso.tom === "alerta" ? "text-alerta" : aviso.tom === "sucesso" ? "text-sucesso" : "text-muted-foreground"} data-testid="os-aviso-whatsapp">
                  {aviso.rotulo}
                  {o.aviso_whatsapp_em ? ` em ${formatarDataHora(o.aviso_whatsapp_em)}` : ""}
                  {o.aviso_whatsapp === "falhou" && o.aviso_whatsapp_erro ? `: ${o.aviso_whatsapp_erro}` : ""}
                </p>
              ) : null}
              {o.entregue_em ? (
                <div className="space-y-1 border-t border-border pt-2">
                  <p>
                    <span className="text-muted-foreground">Entregue:</span> {formatarDataHora(o.entregue_em)}
                    {o.retirado_por ? ` · retirado por ${o.retirado_por}` : ""}
                    {o.retirado_documento ? ` (doc. ${o.retirado_documento})` : ""}
                  </p>
                  {o.assinatura_caminho ? (
                    // eslint-disable-next-line @next/next/no-img-element -- assinatura privada por link temporário
                    <img src={`/api/os/${empresaId}/assinatura/${o.id}`} alt={`Assinatura de ${o.retirado_por ?? "quem retirou"}`} className="h-20 w-auto rounded border border-border bg-white p-1" data-testid="os-assinatura" />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
