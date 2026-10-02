import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { Ajustes, FormParametros, TabelaMeses, type MesConfig, type ParametrosForm } from "@/components/calculos/configuracao";
import type { DadosPrevisao } from "@/lib/calculos/previsao";
import { competenciaDosCalculos, opcoesCompetencia } from "@/lib/calculos/competencias";
import { mensagemErro } from "@/lib/acoes";
import { parametro } from "@/lib/busca";
import { formatarCompetencia } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Configuração dos cálculos" };

const n = (v: unknown) => (v == null ? 0 : Number(v));
const nn = (v: unknown) => (v == null ? null : Number(v));

export default async function ConfiguracaoCalculos({ params, searchParams }: PageProps<"/e/[empresaId]/calculos/configuracao">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.gerenciar")) return <Alerta tom="alerta">Somente a equipe do escritório configura os cálculos.</Alerta>;
  const comp = competenciaDosCalculos(parametro(sp, "competencia"));
  const { data, error } = await ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: comp });
  if (error || !data) return <Alerta tom="perigo">{mensagemErro(error)}</Alerta>;
  const d = data as unknown as DadosPrevisao;
  const regime = d.empresa.regime;
  const par = d.parametros;
  const parametros: ParametrosForm | null = par
    ? {
        inicio_atividade: par.inicio_atividade,
        mei_atividade: par.mei_atividade,
        anexo_mercadorias: par.anexo_mercadorias,
        anexo_servicos: par.anexo_servicos,
        fator_r: par.fator_r,
        presuncao_irpj_mercadorias: n(par.presuncao_irpj_mercadorias),
        presuncao_irpj_servicos: n(par.presuncao_irpj_servicos),
        presuncao_csll_mercadorias: n(par.presuncao_csll_mercadorias),
        presuncao_csll_servicos: n(par.presuncao_csll_servicos),
        acrescimo_lc224: par.acrescimo_lc224,
        creditos_pis_cofins: par.creditos_pis_cofins,
        aliquota_iss: nn(par.aliquota_iss),
        calcular_icms: par.calcular_icms,
        calcular_ipi: par.calcular_ipi,
        rat: n(par.rat),
        fap: n(par.fap),
        terceiros: n(par.terceiros),
        pro_labore: n(par.pro_labore),
        socios_pro_labore: par.socios_pro_labore,
      }
    : null;
  const meses: MesConfig[] = d.meses.map((m) => ({
    competencia: String(m.competencia).slice(0, 10),
    vendas: Math.max(0, n(m.vendas) - n(m.devolucoes)),
    servicos: n(m.servicos) + n(m.servicos_nfe),
    notas: m.notas_saida,
    informado: m.informado
      ? {
          receita_mercadorias: nn(m.informado.receita_mercadorias),
          receita_servicos: nn(m.informado.receita_servicos),
          folha_fator_r: nn(m.informado.folha_fator_r),
          observacao: m.informado.observacao,
        }
      : null,
  }));
  const ajustes = d.ajustes.map((a) => ({ id: a.id, descricao: a.descricao, valor: n(a.valor), observacao: a.observacao }));

  return (
    <>
      <CabecalhoPagina
        titulo="Configuração dos cálculos"
        descricao={
          <>
            Regime em {formatarCompetencia(comp)}: <strong>{regime ? (REGIMES[regime] ?? regime) : "não informado"}</strong>
            {regime === "lucro_real" ? ` (${d.empresa.lucro_real_apuracao ?? "apuração não informada"})` : ""}. O regime e o histórico ficam em{" "}
            <Link href={`/escritorio/obrigacoes/empresas/${empresaId}`} className="text-primary hover:underline">
              Obrigações e prazos → Empresas
            </Link>
            .
          </>
        }
        acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={opcoesCompetencia()} />}
      />
      <div className="space-y-4">
        {!par ? (
          <Alerta tom="info" titulo="Cálculos ainda não configurados">
            Revise os valores abaixo e salve. A partir daí o cliente vê a previsão de cada mês assim que enviar os documentos obrigatórios.
          </Alerta>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Parâmetros da empresa</CardTitle>
            <CardDescription>Valem para todas as competências.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormParametros empresaId={empresaId} regime={regime} parametros={parametros} />
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Receita e folha mês a mês</CardTitle>
              <CardDescription>
                A previsão usa as notas fiscais enviadas. Informe a receita dos meses anteriores ao portal (para a receita de 12 meses do Simples) ou quando as notas
                não representarem todo o faturamento.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <TabelaMeses empresaId={empresaId} meses={meses} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Valores lançados em {formatarCompetencia(comp, true)}</CardTitle>
              <CardDescription>Entram na previsão como itens a pagar (use valor negativo para reduzir). Ex.: ICMS-ST, DIFAL, parcelamentos.</CardDescription>
            </CardHeader>
            <CardContent>
              <Ajustes empresaId={empresaId} competencia={comp} ajustes={ajustes} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
