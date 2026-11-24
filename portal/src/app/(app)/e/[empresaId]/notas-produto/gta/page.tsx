import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AcessoSidago,
  AcoesPedidoGta,
  NovoPedidoGta,
  type ConferenciaTela,
  type EmitenteGta,
  type NotaGta,
  type PedidoGtaTela,
} from "@/components/gta/gta";
import { mensagemErro } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { parametro } from "@/lib/busca";
import { formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { ESPECIES_GTA, FINALIDADES_GTA, ROTULO_FAIXA, STATUS_GTA, TRANSPORTES_GTA } from "@/lib/gta/rotulos";
import type { AnimalGta } from "@/lib/gta/sidago";

export const metadata: Metadata = { title: "GTA no SIDAGO" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Mun = { nome?: string; uf?: string } | null;

export default async function GtaSidago({ params, searchParams }: PageProps<"/e/[empresaId]/notas-produto/gta">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const configurar = ctx.pode("nfe.configurar");
  if (!ctx.pode("nfe.emitir") && !configurar) return <Alerta tom="alerta">Seu acesso não inclui a emissão de NF-e desta empresa.</Alerta>;
  const notaParam = parametro(sp, "nota");
  const notaInicial = notaParam && UUID.test(notaParam) ? notaParam : null;

  const selecaoNota =
    "id, numero, serie, ambiente, emitente_id, destinatario_nome, destinatario_documento, autorizada_em, destinatario:nfe_destinatarios(inscricao_estadual, municipio_ibge, municipio:municipios(uf))";
  const [{ data: acesso }, { data: pedidos, error }, { data: emitentes }, { data: notasRecentes }, { data: empresa }] = await Promise.all([
    ctx.supabase.from("gta_sidago_acesso").select("login_mascarado, situacao, ultimo_teste_em, ultima_mensagem").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("gta_pedidos").select("*, municipio:municipios(nome, uf)").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(100),
    ctx.supabase.from("nfe_emitentes").select("id, nome, inscricao_estadual").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("nfe_emissoes").select(selecaoNota).eq("empresa_id", empresaId).eq("situacao", "autorizada").order("created_at", { ascending: false }).limit(60),
    ctx.supabase.from("empresas").select("demonstracao").eq("id", empresaId).maybeSingle(),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar os pedidos de GTA: {mensagemErro(error)}</Alerta>;

  // Notas já ligadas a pedidos (mesmo as antigas) e a nota pedida pelo link
  const listaNotas = [...(notasRecentes ?? [])];
  const faltam = [...new Set([...(pedidos ?? []).map((p) => p.nfe_emissao_id), notaInicial])].filter(
    (id): id is string => Boolean(id) && !listaNotas.some((n) => n.id === id),
  );
  if (faltam.length) {
    const { data: extras } = await ctx.supabase.from("nfe_emissoes").select(selecaoNota).eq("empresa_id", empresaId).in("id", faltam);
    listaNotas.push(...(extras ?? []));
  }
  const notas: NotaGta[] = listaNotas.map((n) => {
    const d = n.destinatario as unknown as { inscricao_estadual: string | null; municipio_ibge: string | null; municipio: Mun } | null;
    return {
      id: n.id,
      numero: n.numero,
      serie: n.serie,
      ambiente: n.ambiente,
      emitente_id: n.emitente_id,
      destinatario_nome: n.destinatario_nome,
      destinatario_documento: n.destinatario_documento,
      destino_ie: d?.inscricao_estadual ?? null,
      destino_municipio_ibge: d?.municipio_ibge ?? null,
      destino_uf: d?.municipio?.uf ?? null,
      autorizada_em: n.autorizada_em,
    };
  });

  const lista: PedidoGtaTela[] = (pedidos ?? []).map((p) => {
    const m = p.municipio as unknown as Mun;
    return { ...p, animais: p.animais as unknown as AnimalGta[], destino_uf: m?.uf ?? null, destino_municipio: m?.nome ?? null };
  });
  const ids = lista.map((p) => p.id);
  const ultimas = new Map<string, ConferenciaTela>();
  if (ids.length) {
    const { data: conf } = await ctx.supabase
      .from("gta_conferencias")
      .select("pedido_id, ok, mensagem, mapeamento, created_at")
      .in("pedido_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const c of conf ?? []) if (!ultimas.has(c.pedido_id)) ultimas.set(c.pedido_id, c as unknown as ConferenciaTela);
  }
  const listaEmitentes = (emitentes ?? []) as EmitenteGta[];
  const oficial = envPublico.ambiente() === "producao" && !empresa?.demonstracao;

  return (
    <>
      <CabecalhoPagina
        titulo="GTA no SIDAGO (Goiás)"
        descricao="Prepare aqui os dados da Guia de Trânsito Animal. O robô entra no SIDAGO com o acesso do produtor e confere o formulário da GTA com esses dados, sem emitir nada."
        voltar={{ href: `/e/${empresaId}/notas-produto`, rotulo: "Notas de produto" }}
        acoes={<NovoPedidoGta empresaId={empresaId} emitentes={listaEmitentes} notas={notas} notaInicial={notaInicial} />}
      />
      {!oficial ? (
        <Alerta tom="info" className="mb-4">
          Neste ambiente (demonstração ou teste) o robô não acessa o SIDAGO: os pedidos podem ser preparados, mas a conferência só funciona no portal oficial, com empresa real.
        </Alerta>
      ) : null}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Acesso ao SIDAGO</CardTitle>
            <CardDescription>Usuário e senha do produtor no SIDAGO (Agrodefesa). Modo conferência: o robô só entra e lê o formulário da GTA.</CardDescription>
          </CardHeader>
          <CardContent>
            <AcessoSidago empresaId={empresaId} acesso={acesso} podeConfigurar={configurar} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pedidos de GTA</CardTitle>
            <CardDescription>
              Ordem em Goiás: emita a GTA no SIDAGO, use o número dela na nota fiscal e informe o número da nota no SIDAGO (até 24 h antes de imprimir a GTA de bovinos).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!lista.length ? (
              <EstadoVazio titulo="Nenhum pedido de GTA" descricao="Crie um pedido com o destino, os animais e o transporte. Dá para começar pela nota fiscal da venda." />
            ) : (
              <ul className="divide-y divide-border">
                {lista.map((p) => {
                  const st = STATUS_GTA[p.status] ?? STATUS_GTA.rascunho;
                  const conf = ultimas.get(p.id) ?? null;
                  return (
                    <li key={p.id} className="space-y-2 py-4 first:pt-0 last:pb-0" data-testid="pedido-gta">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{p.destino_nome}</strong>
                        <Badge variante={st.variante}>{st.rotulo}</Badge>
                        {p.gta_numero ? (
                          <Badge variante="contorno">
                            GTA nº {p.gta_numero}
                            {p.gta_serie ? ` série ${p.gta_serie}` : ""}
                          </Badge>
                        ) : null}
                      </div>
                      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3 [&_dt]:text-xs [&_dt]:text-muted-foreground">
                        <div>
                          <dt>Animais</dt>
                          <dd>
                            {p.total_animais} {ESPECIES_GTA[p.especie]?.toLowerCase() ?? p.especie} —{" "}
                            {p.animais.map((a) => `${a.quantidade} ${a.sexo === "macho" ? "M" : "F"} ${ROTULO_FAIXA[a.faixa]}`).join("; ")}
                          </dd>
                        </div>
                        <div>
                          <dt>Finalidade e saída</dt>
                          <dd>
                            {FINALIDADES_GTA[p.finalidade] ?? p.finalidade} · {formatarData(p.data_saida)}
                          </dd>
                        </div>
                        <div>
                          <dt>Destino</dt>
                          <dd>
                            {[p.destino_documento ? formatarDocumento(p.destino_documento) : null, p.destino_municipio ? `${p.destino_municipio}/${p.destino_uf}` : null, p.destino_codigo]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Transporte</dt>
                          <dd>
                            {TRANSPORTES_GTA[p.transporte] ?? p.transporte}
                            {p.placa ? ` · placa ${p.placa}${p.placa_uf ? `/${p.placa_uf}` : ""}` : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Nota fiscal</dt>
                          <dd>{p.nf_numero ? `Nº ${p.nf_numero}${p.nf_serie != null ? ` série ${p.nf_serie}` : ""}` : "Ainda sem nota"}</dd>
                        </div>
                        <div>
                          <dt>Última conferência</dt>
                          <dd>{conf ? `${conf.ok ? "Formulário encontrado" : "Não concluída"} · ${formatarDataHora(conf.created_at)}` : "Ainda não conferido"}</dd>
                        </div>
                      </dl>
                      <AcoesPedidoGta empresaId={empresaId} pedido={p} conferencia={conf} emitentes={listaEmitentes} notas={notas} temAcesso={Boolean(acesso)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
