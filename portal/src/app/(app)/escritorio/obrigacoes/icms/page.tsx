import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EditarIcmsUf, ProporRegraIcms, SimuladorIcms, SituacaoRegra, type EstadoIcms, type SituacaoRegraIcms } from "@/components/obrigacoes/icms-estados";
import { hojeISO } from "@/lib/competencia";
import { formatarData } from "@/lib/formatos";
import {
  REGIOES,
  SITUACAO_ALIQUOTA,
  SITUACAO_VENCIMENTO,
  aliquotaInterestadual,
  textoAliquota,
  textoVencimento,
  type Regiao,
  type SituacaoAliquota,
  type SituacaoVencimento,
} from "@/lib/fiscal/icms-estados";

export const metadata: Metadata = { title: "ICMS por estado" };

function Fonte({ titulo, url }: { titulo: string | null; url: string | null }) {
  if (!titulo && !url) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {titulo}
      {url ? (
        <>
          {" "}
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            fonte <ExternalLink className="size-3" aria-hidden />
          </a>
        </>
      ) : null}
    </p>
  );
}

function BlocoAliquota({ e }: { e: EstadoIcms }) {
  const sa = SITUACAO_ALIQUOTA[e.aliquota_situacao as SituacaoAliquota];
  return (
    <div>
      <p className="font-semibold numero">
        {textoAliquota(e.aliquota_interna)}
        {e.fcp ? <span className="font-normal"> + {textoAliquota(e.fcp)} fundo de pobreza</span> : null}
      </p>
      {sa ? (
        <Badge variante={sa.variante} title={sa.ajuda}>
          {sa.rotulo}
        </Badge>
      ) : null}
      {e.aliquota_vigencia ? <p className="mt-1 text-xs text-muted-foreground">Desde {formatarData(e.aliquota_vigencia)}</p> : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-primary">Fonte da alíquota</summary>
        <div className="mt-1 space-y-1">
          <Fonte titulo={e.aliquota_base_legal} url={e.aliquota_fonte_url} />
          {e.aliquota_observacao ? <p className="text-xs">{e.aliquota_observacao}</p> : null}
          {e.fcp_observacao ? <p className="text-xs">{e.fcp_observacao}</p> : null}
        </div>
      </details>
    </div>
  );
}

function BlocoVencimento({ e, regra }: { e: EstadoIcms; regra: SituacaoRegraIcms }) {
  const sv = SITUACAO_VENCIMENTO[e.vencimento_situacao as SituacaoVencimento];
  return (
    <div>
      <p className="text-sm font-medium">{textoVencimento(e)}</p>
      <div className="flex flex-wrap gap-1">
        {sv ? (
          <Badge variante={sv.variante} title={sv.ajuda}>
            {sv.rotulo}
          </Badge>
        ) : null}
        <SituacaoRegra situacao={regra} />
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-primary">Fonte do prazo</summary>
        <div className="mt-1 space-y-1">
          <Fonte titulo={e.vencimento_base_legal} url={e.vencimento_fonte_url} />
          {e.vencimento_observacao ? <p className="text-xs">{e.vencimento_observacao}</p> : null}
          <p className="text-xs text-muted-foreground">Conferido em {formatarData(e.conferido_em)}</p>
        </div>
      </details>
    </div>
  );
}

export default async function IcmsPorEstado() {
  const s = await exigirEquipe();
  const admin = s.perfil.tipo === "admin";
  const hoje = hojeISO();
  const competenciaAtual = `${hoje.slice(0, 7)}-01`;
  const [{ data: linhas }, { data: obrigacao }, { data: escritorio }] = await Promise.all([
    s.supabase.from("icms_uf").select("*").order("uf"),
    s.supabase.from("obrigacoes").select("id").eq("codigo", "ICMS").maybeSingle(),
    s.supabase.from("escritorio").select("uf").eq("id", 1).maybeSingle(),
  ]);
  const { data: regras } = obrigacao
    ? await s.supabase
        .from("obrigacao_regras")
        .select("ufs, status, vigencia_fim, prazo_pagamento")
        .eq("obrigacao_id", obrigacao.id)
        .is("empresa_id", null)
        .in("status", ["validada", "rascunho"])
    : { data: [] };

  const estados = (linhas ?? []) as (EstadoIcms & { regiao: string })[];
  const situacaoRegra = (e: EstadoIcms): SituacaoRegraIcms => {
    const daUf = (regras ?? []).filter((r) => (r.ufs ?? []).includes(e.uf));
    if (daUf.some((r) => r.status === "rascunho")) return "proposta";
    const validada = daUf.find((r) => r.status === "validada" && (!r.vigencia_fim || r.vigencia_fim >= competenciaAtual));
    if (!validada) return "nenhuma";
    const prazo = (validada.prazo_pagamento ?? {}) as { dia?: number; ajuste?: string };
    const igual = e.vencimento_situacao === "conferido" && Number(prazo.dia) === e.vencimento_dia && prazo.ajuste === e.vencimento_ajuste;
    return igual ? "validada" : "diferente";
  };
  const conta = (f: (e: EstadoIcms) => boolean) => estados.filter(f).length;
  const origemInicial = escritorio?.uf?.trim().toUpperCase() || "TO";

  return (
    <>
      <CabecalhoPagina
        titulo="ICMS por estado"
        descricao="Alíquota interna geral, fundo de pobreza e vencimento do ICMS apurado no regime normal de cada estado, sempre com a fonte oficial. As alíquotas entre estados seguem as Resoluções do Senado."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Alíquotas conferidas na lei" valor={`${conta((e) => e.aliquota_situacao === "conferida")} de ${estados.length}`} tom="sucesso" />
        <Indicador rotulo="Alíquotas a confirmar" valor={conta((e) => e.aliquota_situacao !== "conferida")} detalhe="Informadas pelo estado ou a conferir" tom="info" />
        <Indicador rotulo="Prazos conferidos" valor={`${conta((e) => e.vencimento_situacao === "conferido")} de ${estados.length}`} tom="sucesso" />
        <Indicador rotulo="Prazos a conferir" valor={conta((e) => e.vencimento_situacao === "a_conferir")} detalhe="Sem data inventada: completar com a fonte" tom="alerta" />
      </div>

      <Alerta tom="info" className="mb-5" titulo="Como os prazos viram tarefas">
        O prazo conferido de um estado vira <strong>proposta de regra</strong> do ICMS. Depois que o administrador valida em{" "}
        <Link href="/escritorio/obrigacoes/normas" className="font-medium text-primary hover:underline">
          Atualizações normativas
        </Link>
        , as tarefas são geradas para as empresas do Lucro Presumido, Real ou Arbitrado marcadas como contribuintes do ICMS naquele estado. Estados
        &quot;a conferir&quot; não geram tarefa até alguém completar o prazo com a fonte oficial{admin ? " (botão de lápis)" : " (pelo administrador)"}.
      </Alerta>

      <div className="mb-6">
        <SimuladorIcms estados={estados} origemInicial={origemInicial} />
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold text-titulo">Alíquota interna e vencimento por estado</h2>
        <Table>
          <THead>
            <tr>
              <Th>Estado</Th>
              <Th className="hidden md:table-cell">Alíquota interna geral</Th>
              <Th className="hidden md:table-cell">Vencimento do ICMS (regime normal)</Th>
              <Th className="w-28" />
            </tr>
          </THead>
          <TBody>
            {estados.map((e) => {
              const regra = situacaoRegra(e);
              return (
                <Tr key={e.uf} id={`uf-${e.uf}`}>
                  <Td className="align-top">
                    <p className="font-semibold">{e.uf}</p>
                    <p className="text-sm">{e.nome}</p>
                    <p className="text-xs text-muted-foreground">{REGIOES[e.regiao as Regiao]}</p>
                    {/* No celular, alíquota e vencimento ficam empilhados aqui */}
                    <div className="mt-2 space-y-3 md:hidden">
                      <BlocoAliquota e={e} />
                      <BlocoVencimento e={e} regra={regra} />
                    </div>
                  </Td>
                  <Td className="hidden align-top md:table-cell">
                    <BlocoAliquota e={e} />
                  </Td>
                  <Td className="hidden align-top md:table-cell">
                    <BlocoVencimento e={e} regra={regra} />
                  </Td>
                  <Td className="align-top">
                    <div className="flex flex-col items-end gap-1">
                      {admin ? <EditarIcmsUf estado={e} hoje={hoje} /> : null}
                      {e.vencimento_situacao === "conferido" && regra === "nenhuma" ? <ProporRegraIcms uf={e.uf} /> : null}
                      {e.vencimento_situacao === "conferido" && regra === "diferente" ? <ProporRegraIcms uf={e.uf} alteracao /> : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </section>

      <section>
        <h2 className="text-base font-semibold text-titulo">Alíquotas interestaduais</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Linha = estado de origem; coluna = estado de destino. <strong>7%</strong> nas saídas do Sul e do Sudeste (exceto Espírito Santo) para o
          Norte, o Nordeste, o Centro-Oeste e o Espírito Santo; <strong>12%</strong> nas demais (Resolução do Senado nº 22/1989).{" "}
          <strong>4%</strong> para mercadoria importada ou com conteúdo de importação acima de 40% (Resolução nº 13/2012) e no transporte aéreo
          (Resolução nº 95/1996). Na diagonal, a alíquota interna geral do estado.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border" role="region" aria-label="Matriz de alíquotas interestaduais" tabIndex={0}>
          <table className="w-max border-collapse text-xs numero">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-semibold">
                  Origem ↓ / Destino →
                </th>
                {estados.map((d) => (
                  <th key={d.uf} scope="col" className="px-1.5 py-1.5 font-semibold">
                    {d.uf}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {estados.map((o) => (
                <tr key={o.uf} className="border-t border-border">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-semibold">
                    {o.uf}
                  </th>
                  {estados.map((d) => {
                    const a = aliquotaInterestadual(o.uf, d.uf);
                    return (
                      <td
                        key={d.uf}
                        className={
                          a === null
                            ? "bg-muted px-1.5 py-1 text-center text-muted-foreground"
                            : a === 7
                              ? "bg-info-bg px-1.5 py-1 text-center font-semibold text-info-fg"
                              : "px-1.5 py-1 text-center"
                        }
                        title={a === null ? `${o.nome}: interna geral ${textoAliquota(o.aliquota_interna)}` : `${o.uf} → ${d.uf}: ${a}%`}
                      >
                        {a === null ? (o.aliquota_interna == null ? "—" : String(o.aliquota_interna).replace(".", ",")) : a}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
