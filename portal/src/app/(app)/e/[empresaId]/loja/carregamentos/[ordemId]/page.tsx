import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, FileText, Pencil, Route } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { CarregamentosIndisponivel, NavegacaoCarregamentos } from "@/components/loja/navegacao-loja";
import { CancelarOrdem, FormPesagem } from "@/components/loja/carregamentos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { FRETE_POR_CONTA, STATUS_ORDEM, formatarKg, mostrarPlaca, notaVale, quantidadePelaPesagem, type StatusOrdem } from "@/lib/gestao/carregamentos";
import { formatarQuantidade } from "@/lib/gestao/rotulos";
import { SITUACAO_NFE } from "@/lib/nfe-emissao/rotulos";
import { SITUACAO_CTE, type SituacaoCte } from "@/lib/cte-emissao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Ordem de carregamento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaOrdem({ params }: PageProps<"/e/[empresaId]/loja/carregamentos/[ordemId]">) {
  const { empresaId, ordemId } = await params;
  if (!UUID.test(ordemId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.carrega) return <CarregamentosIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const emiteCte = ctx.acesso.cte && ctx.pode("cte.emitir");
  const [{ data: o }, { data: nfeCfg }, { data: padrao }, { data: ctes }] = await Promise.all([
    ctx.supabase
      .from("ordens_carregamento")
      .select(
        "*, produto:nfe_produtos(peso_kg), emitente:nfe_emitentes(nome, inscricao_estadual), nota:nfe_emissoes(id, numero, serie, situacao), criador:perfis!ordens_carregamento_criado_por_fkey(nome), cancelador:perfis!ordens_carregamento_cancelada_por_fkey(nome)",
      )
      .eq("id", ordemId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("nfe_config").select("ativa").eq("empresa_id", empresaId).maybeSingle(),
    // Inscrição que vende quando a ordem não escolhe outra (configurações da gestão)
    ctx.supabase.from("gestao_config").select("emitente:nfe_emitentes(nome, inscricao_estadual)").eq("empresa_id", empresaId).maybeSingle(),
    // CT-e emitidos a partir desta ordem (quando a empresa também emite CT-e)
    emiteCte
      ? ctx.supabase.from("cte_emissoes").select("id, numero, situacao").eq("empresa_id", empresaId).eq("origem->>ordem_id", ordemId).order("created_at")
      : Promise.resolve({ data: [] as { id: string; numero: number; situacao: string }[] }),
  ]);
  if (!o) notFound();

  const st = STATUS_ORDEM[o.status as StatusOrdem];
  const nota = o.nota as {
    id: string;
    numero: number;
    serie: number;
    situacao: string;
  } | null;
  const notaAtiva = o.status === "faturada" && notaVale(nota?.situacao);
  const cancelada = o.status === "cancelada";
  const editavel = !cancelada && !notaAtiva;
  const pesoKgUnidade = (o.produto as { peso_kg: number | null } | null)?.peso_kg ?? null;
  const naUnidade = o.peso_liquido_kg != null ? quantidadePelaPesagem(o.peso_liquido_kg, o.unidade, pesoKgUnidade) : null;
  const quantidadeNota = naUnidade ?? dec(o.quantidade);
  const valorEstimado = o.preco_unitario != null ? quantidadeNota.times(o.preco_unitario) : null;
  const emitente = (o.emitente ?? padrao?.emitente) as { nome: string; inscricao_estadual: string } | null;
  const base = `/e/${empresaId}/loja/carregamentos`;
  const pdf = `/api/loja/carregamentos/${o.id}/pdf`;

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Ordem de carregamento nº {o.numero} <Badge variante={st?.variante}>{st?.rotulo ?? o.status}</Badge>
          </span>
        }
        descricao={`Emitida em ${formatarData(o.data_emissao)}${(o.criador as { nome: string } | null)?.nome ? ` por ${(o.criador as { nome: string }).nome}` : ""}${o.validade ? ` · válida até ${formatarData(o.validade)}` : ""}.`}
        voltar={{ href: base, rotulo: "Ordens de carregamento" }}
        acoes={
          <div className="flex flex-wrap gap-2">
            <Button asChild variante="contorno">
              <a href={`${pdf}?ver=1`} target="_blank" rel="noopener">
                <FileDown /> Imprimir (PDF)
              </a>
            </Button>
            {editavel ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/${o.id}/editar`}>
                  <Pencil /> Alterar
                </Link>
              </Button>
            ) : null}
            {editavel && nfeCfg?.ativa ? (
              <Button asChild>
                <Link href={`/e/${empresaId}/notas-produto/nova?ordem=${o.id}`}>
                  <FileText /> Emitir NF-e
                </Link>
              </Button>
            ) : null}
            {emiteCte && !cancelada && [0, 1, 2].includes(o.frete_por_conta) ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/cte/nova?ordem=${o.id}`}>
                  <Route /> Emitir CT-e
                </Link>
              </Button>
            ) : null}
            {editavel ? <CancelarOrdem empresaId={empresaId} ordemId={o.id} placa={o.placa} /> : null}
          </div>
        }
      />
      <NavegacaoCarregamentos empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} cte={ctx.acesso.cte && ctx.pode("cte.emitir")} />

      {cancelada ? (
        <Alerta tom="perigo" titulo="Ordem cancelada" className="mb-4">
          {o.motivo_cancelamento ?? "Sem motivo informado."} — {formatarDataHora(o.cancelada_em)}
          {(o.cancelador as { nome: string } | null)?.nome ? ` por ${(o.cancelador as { nome: string }).nome}` : ""}.
        </Alerta>
      ) : null}
      {editavel && !nfeCfg?.ativa ? (
        <Alerta tom="info" titulo="Emissão de NF-e desligada" className="mb-4">
          A ordem funciona normalmente (impressão e pesagem). Para emitir a NF-e por aqui, o escritório precisa ligar a emissão desta empresa (certificado
          digital e autorização na SEFAZ). Até lá, a nota continua saindo pelo sistema que a empresa já usa.
        </Alerta>
      ) : null}
      {o.status === "carregada" && nfeCfg?.ativa ? (
        <Alerta tom="alerta" className="mb-4">
          Caminhão pesado e carregado: emita a NF-e antes de ele sair. A nota vem preenchida com o peso líquido, o comprador e o transporte.
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Venda</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <Item
                rotulo="Comprador"
                valor={o.destinatario_nome}
                detalhe={o.destinatario_documento ? formatarDocumento(o.destinatario_documento) : undefined}
              />
              <Item rotulo="Produto" valor={o.produto_descricao} />
              <Item
                rotulo="Quantidade prevista"
                valor={`${formatarQuantidade(o.quantidade)} ${o.unidade}`}
                detalhe={o.peso_previsto_kg != null ? formatarKg(o.peso_previsto_kg) : undefined}
              />
              <Item
                rotulo="Preço"
                valor={o.preco_unitario != null ? `${formatarMoeda(o.preco_unitario)} por ${o.unidade}` : "—"}
                detalhe={valorEstimado ? `${naUnidade ? "valor pela pesagem" : "valor previsto"}: ${formatarMoeda(valorEstimado)}` : undefined}
              />
              <Item rotulo="Contrato ou pedido" valor={o.contrato ?? "—"} />
              <Item
                rotulo="Quem vende"
                valor={emitente ? emitente.nome : "—"}
                detalhe={emitente ? `IE ${emitente.inscricao_estadual}` : undefined}
              />
              <Item rotulo="Local de carregamento" valor={o.local_carregamento ?? "—"} />
              <Item rotulo="Local de descarga" valor={o.local_descarga ?? "—"} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transporte</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <Item rotulo="Frete" valor={FRETE_POR_CONTA[o.frete_por_conta] ?? String(o.frete_por_conta)} />
              <Item
                rotulo="Transportadora"
                valor={o.transportador_nome ?? "—"}
                detalhe={o.transportador_documento ? formatarDocumento(o.transportador_documento) : undefined}
              />
              <Item rotulo="Motorista" valor={o.motorista_nome ?? "—"} detalhe={o.motorista_cpf ? `CPF ${formatarDocumento(o.motorista_cpf)}` : undefined} />
              <Item rotulo="RNTRC (ANTT)" valor={o.rntrc ?? "—"} />
              <Item rotulo="Placa do caminhão" valor={`${mostrarPlaca(o.placa)}${o.placa_uf ? ` / ${o.placa_uf}` : ""}`} />
              <Item rotulo="Carretas" valor={o.placas_reboque.length ? o.placas_reboque.map((p: string) => mostrarPlaca(p)).join(", ") : "—"} />
            </dl>
            {o.observacoes ? <p className="mt-3 whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-sm">{o.observacoes}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pesagem na balança</CardTitle>
          </CardHeader>
          <CardContent>
            {o.peso_liquido_kg != null ? (
              <dl className="mb-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <Item rotulo="Bruto" valor={formatarKg(o.peso_bruto_kg)} />
                <Item rotulo="Tara" valor={formatarKg(o.tara_kg)} />
                <Item
                  rotulo="Líquido"
                  valor={formatarKg(o.peso_liquido_kg)}
                  detalhe={naUnidade && o.unidade.toUpperCase() !== "KG" ? `${formatarQuantidade(naUnidade)} ${o.unidade}` : undefined}
                  forte
                />
                <Item rotulo="Umidade" valor={o.umidade != null ? `${formatarQuantidade(o.umidade, 2)}%` : "—"} />
                <Item rotulo="Impureza" valor={o.impureza != null ? `${formatarQuantidade(o.impureza, 2)}%` : "—"} />
                <Item rotulo="Ticket" valor={o.ticket_balanca ?? "—"} detalhe={o.carregado_em ? formatarDataHora(o.carregado_em) : undefined} />
              </dl>
            ) : null}
            {editavel ? (
              <FormPesagem
                empresaId={empresaId}
                ordemId={o.id}
                unidade={o.unidade}
                pesoKgUnidade={pesoKgUnidade}
                atual={
                  o.peso_bruto_kg != null
                    ? {
                        bruto: String(o.peso_bruto_kg),
                        tara: String(o.tara_kg),
                        umidade: o.umidade == null ? null : String(o.umidade),
                        impureza: o.impureza == null ? null : String(o.impureza),
                        ticket: o.ticket_balanca,
                      }
                    : null
                }
              />
            ) : o.peso_liquido_kg == null ? (
              <p className="text-sm text-muted-foreground">Sem pesagem registrada.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nota fiscal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {nota ? (
              <>
                <p>
                  <Link href={`/e/${empresaId}/notas-produto/${nota.id}`} className="font-semibold hover:underline">
                    NF-e nº {nota.numero} (série {nota.serie})
                  </Link>{" "}
                  <Badge variante={SITUACAO_NFE[nota.situacao as keyof typeof SITUACAO_NFE]?.tom === "sucesso" ? "sucesso" : notaAtiva ? "info" : "neutro"}>
                    {SITUACAO_NFE[nota.situacao as keyof typeof SITUACAO_NFE]?.rotulo ?? nota.situacao}
                  </Badge>
                </p>
                {!notaAtiva ? <p className="text-muted-foreground">A nota anterior não vale mais: corrija a ordem, se precisar, e emita outra.</p> : null}
              </>
            ) : (
              <p className="text-muted-foreground">Ainda sem NF-e. Emita depois da pesagem: a quantidade sai do peso líquido da balança.</p>
            )}
            {(ctes ?? []).map((c) => (
              <p key={c.id}>
                <Link href={`/e/${empresaId}/cte/${c.id}`} className="font-semibold hover:underline">
                  CT-e nº {c.numero}
                </Link>{" "}
                <Badge variante={SITUACAO_CTE[c.situacao as SituacaoCte]?.tom ?? "neutro"}>{SITUACAO_CTE[c.situacao as SituacaoCte]?.rotulo ?? c.situacao}</Badge>
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              A ordem de carregamento é um documento de controle interno: não substitui a NF-e nem os documentos do transporte (MDF-e ou CT-e, quando exigidos).
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Item({ rotulo, valor, detalhe, forte }: { rotulo: string; valor: string; detalhe?: string; forte?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={forte ? "font-semibold numero" : "break-words"}>{valor}</dd>
      {detalhe ? <dd className="text-xs text-muted-foreground">{detalhe}</dd> : null}
    </div>
  );
}
