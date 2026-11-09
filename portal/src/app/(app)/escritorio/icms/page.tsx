import type { Metadata } from "next";
import Link from "next/link";
import Decimal from "decimal.js";
import { Landmark } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmitirDaresLote, type CandidataDare } from "@/components/dare-to/lote";
import { hojeISO, somarMeses } from "@/lib/competencia";
import { envPublico } from "@/lib/env";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { carregarIcms } from "@/lib/calculos/icms-carregar";
import { mudouDesdeConferencia, type ResultadoIcms } from "@/lib/calculos/icms";
import { competenciaDosCalculos, opcoesCompetencia } from "@/lib/calculos/competencias";
import { parametro } from "@/lib/busca";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarCompetencia } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";
import { REGIMES } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Apuração do ICMS da carteira" };

interface EmpresaCarteira {
  id: string;
  nome: string;
  documento: string;
  uf: string | null;
  regime: string | null;
  contribuinte_icms: boolean;
  conferida_em: string | null;
  a_recolher: number | string | null;
  total_guias: number | string | null;
  saldo_credor_transportar: number | string | null;
  notas: number;
}

interface Linha {
  e: EmpresaCarteira;
  r: ResultadoIcms | null;
  erro: string | null;
  mudou: boolean;
}

const RELEVANTES = new Set(["simples_nacional", "mei", "lucro_presumido", "lucro_real", "lucro_arbitrado"]);
const SIMULTANEAS = 6;

/** ICMS a pagar no mês de todas as empresas que a equipe gerencia (conferido ou calculado agora). */
export default async function IcmsCarteira({ searchParams }: PageProps<"/escritorio/icms">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = competenciaDosCalculos(parametro(sp, "competencia"));
  const mes = formatarCompetencia(comp, true);
  const cabecalho = (
    <CabecalhoPagina
      titulo="Apuração do ICMS"
      descricao="ICMS a pagar no mês por empresa: apuração própria (regime normal), complementação de alíquota e diferencial de alíquotas, com a situação da conferência."
      acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={opcoesCompetencia()} />}
    />
  );

  const { data, error } = await s.supabase.rpc("icms_carteira", { p_competencia: comp });
  if (error) {
    return (
      <>
        {cabecalho}
        <Alerta tom="perigo">{mensagemErro(error)}</Alerta>
      </>
    );
  }
  const empresas = ((data ?? []) as unknown as EmpresaCarteira[]).filter((e) => e.regime && RELEVANTES.has(e.regime));

  // Calcula as não conferidas (e confere se as conferidas mudaram), algumas por vez
  const linhas: Linha[] = [];
  for (let i = 0; i < empresas.length; i += SIMULTANEAS) {
    const grupo = await Promise.all(
      empresas.slice(i, i + SIMULTANEAS).map(async (e): Promise<Linha> => {
        if (!e.notas && !e.conferida_em) return { e, r: null, erro: null, mudou: false };
        const c = await carregarIcms(s.supabase, e.id, comp);
        if ("erro" in c) return { e, r: null, erro: c.erro, mudou: false };
        return { e, r: c.resultado, erro: null, mudou: e.conferida_em ? mudouDesdeConferencia(c.resultado, c.dados.apuracao?.resultado) : false };
      }),
    );
    linhas.push(...grupo);
  }

  const total = (l: Linha) => (l.e.conferida_em ? dec(l.e.total_guias) : (l.r?.totalGuias ?? new Decimal(0)));
  const valor = (l: Linha, chave: string) => l.r?.linhas.find((x) => x.chave === chave)?.valor ?? new Decimal(0);
  const totalCarteira = linhas.reduce((t, l) => t.plus(total(l)), new Decimal(0));
  const conferidas = linhas.filter((l) => l.e.conferida_em).length;
  const aConferir = linhas.filter((l) => !l.e.conferida_em && l.r && l.r.modo !== "nao_contribuinte" && l.r.modo !== "sem_regime" && (l.e.notas > 0 || l.r.totalGuias.gt(0))).length;

  // DARE da complementação (Tocantins): emissão em lote pelo robô da SEFAZ-TO
  const comComplementacaoTo = linhas.filter((l) => (l.e.uf ?? "").toUpperCase() === "TO" && l.r?.modo === "simples" && valor(l, "complementacao").gt(0));
  const emitidos = new Map<string, { numero: string }>();
  let candidatas: CandidataDare[] = [];
  let bloqueioLote: string | null = null;
  let semConferencia = 0;
  if (comComplementacaoTo.length) {
    const [{ data: acessoDare }, { data: jaEmitidos }] = await Promise.all([
      s.supabase.from("dare_to_acesso").select("situacao").maybeSingle(),
      s.supabase.rpc("dare_to_emitidos_mes", { p_competencia: comp }),
    ]);
    for (const e of jaEmitidos ?? []) emitidos.set(e.empresa_id, { numero: e.numero });
    const hoje = hojeISO();
    const vencimento = (l: Linha) => l.r?.linhas.find((x) => x.chave === "complementacao")?.vencimento ?? `${somarMeses(comp, 1).slice(0, 7)}-09`;
    semConferencia = comComplementacaoTo.filter((l) => !l.e.conferida_em || l.mudou).length;
    candidatas = comComplementacaoTo
      .filter((l) => l.e.conferida_em && !l.mudou && !emitidos.has(l.e.id) && valor(l, "complementacao").gte(3) && vencimento(l) >= hoje)
      .map((l) => ({ id: l.e.id, nome: l.e.nome, valor: valor(l, "complementacao").toFixed(2) }));
    bloqueioLote =
      envPublico.ambiente() !== "producao"
        ? "Fora do portal oficial (demonstração ou teste) o robô não acessa a SEFAZ-TO. No portal oficial, a emissão funciona de verdade."
        : !acessoDare
          ? "O robô do DARE está desconectado: o administrador cadastra o acesso à SEFAZ-TO em Configurações → Integrações."
          : acessoDare.situacao !== "conectado"
            ? "O acesso à SEFAZ-TO ainda não passou no teste (Configurações → Integrações → Testar conexão)."
            : null;
  }

  return (
    <>
      {cabecalho}
      {linhas.length === 0 ? (
        <EstadoVazio icone={Landmark} titulo="Nenhuma empresa para apurar" descricao="As empresas do Simples Nacional, MEI, Lucro Presumido e Lucro Real que você gerencia aparecem aqui." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Indicador rotulo={`Guias de ICMS de ${mes}`} valor={formatarMoeda(totalCarteira)} detalhe="Soma da carteira (conferido ou calculado agora)" tom="info" />
            <Indicador rotulo="Conferidas" valor={String(conferidas)} detalhe={`de ${linhas.length} ${linhas.length === 1 ? "empresa" : "empresas"}`} tom="sucesso" />
            <Indicador rotulo="A conferir" valor={String(aConferir)} detalhe="Com notas ou guias no mês" tom={aConferir ? "alerta" : "neutro"} />
          </div>
          {comComplementacaoTo.length ? (
            <Card id="dare-to-lote">
              <CardHeader>
                <CardTitle>DARE da complementação de alíquota (SEFAZ-TO)</CardTitle>
                <CardDescription>
                  {comComplementacaoTo.length} {comComplementacaoTo.length === 1 ? "empresa do Tocantins tem" : "empresas do Tocantins têm"} complementação em {mes}
                  {emitidos.size ? `; ${emitidos.size} com DARE emitido` : ""}
                  {semConferencia ? `; ${semConferencia} ainda sem conferência (confira antes de emitir)` : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmitirDaresLote competencia={comp} candidatas={candidatas} bloqueio={bloqueioLote} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Empresa</Th>
                    <Th className="hidden md:table-cell text-right">ICMS próprio</Th>
                    <Th className="hidden md:table-cell text-right">Complementação</Th>
                    <Th className="hidden md:table-cell text-right">DIFAL</Th>
                    <Th className="text-right">Total em guias</Th>
                  </Tr>
                </THead>
                <TBody>
                  {linhas.map((l) => (
                    <Tr key={l.e.id}>
                      <Td>
                        <Link href={`/e/${l.e.id}/calculos/icms?competencia=${comp.slice(0, 7)}`} className="font-medium text-titulo hover:underline">
                          {l.e.nome}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {formatarCnpj(l.e.documento)} · {REGIMES[l.e.regime ?? ""] ?? l.e.regime} · {l.e.uf ?? "—"}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {l.e.conferida_em ? (
                            <Badge variante={l.mudou ? "alerta" : "sucesso"}>{l.mudou ? "conferida, mas mudou" : "conferida"}</Badge>
                          ) : l.erro ? (
                            <Badge variante="perigo">erro ao calcular</Badge>
                          ) : l.r?.modo === "nao_contribuinte" ? (
                            <Badge variante="neutro">não contribuinte</Badge>
                          ) : !l.e.notas ? (
                            <Badge variante="neutro">sem notas no mês</Badge>
                          ) : (
                            <Badge variante="alerta">a conferir</Badge>
                          )}
                          {l.r?.semXml.notas.length ? <Badge variante="alerta">{l.r.semXml.notas.length} sem XML</Badge> : null}
                          {emitidos.get(l.e.id) ? <Badge variante="info">DARE nº {emitidos.get(l.e.id)!.numero}</Badge> : null}
                        </span>
                      </Td>
                      <Td className="hidden md:table-cell text-right numero">{l.r?.propria ? formatarMoeda(l.r.propria.aRecolher) : "—"}</Td>
                      <Td className="hidden md:table-cell text-right numero">{l.r?.modo === "simples" ? formatarMoeda(valor(l, "complementacao")) : "—"}</Td>
                      <Td className="hidden md:table-cell text-right numero">{l.r ? formatarMoeda(valor(l, "difal")) : "—"}</Td>
                      <Td className="text-right numero font-semibold">{formatarMoeda(total(l))}</Td>
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <Tr>
                    <Td className="font-semibold">Total</Td>
                    <Td className="hidden md:table-cell" />
                    <Td className="hidden md:table-cell" />
                    <Td className="hidden md:table-cell" />
                    <Td className="text-right numero font-bold text-titulo">{formatarMoeda(totalCarteira)}</Td>
                  </Tr>
                </TFoot>
              </Table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Empresas conferidas mostram o valor guardado na conferência; as demais, o cálculo de agora com as notas do portal. Abra a empresa para conferir a destinação das
            compras, lançar créditos e débitos e conferir o mês. O portal não emite DARE nem transmite a EFD.
          </p>
        </div>
      )}
    </>
  );
}
