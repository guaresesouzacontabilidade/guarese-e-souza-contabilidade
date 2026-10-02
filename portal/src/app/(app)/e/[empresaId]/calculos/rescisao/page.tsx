import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { SimuladorRescisao, type ColaboradorSimulacao } from "@/components/calculos/simulador-rescisao";
import type { TipoFolha } from "@/lib/calculos/rescisao";
import { hojeISO } from "@/lib/competencia";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Simulação de rescisão" };

export default async function PaginaRescisao({ params }: PageProps<"/e/[empresaId]/calculos/rescisao">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.ver")) return null;
  const hoje = hojeISO();
  const [colabs, parametros, regime] = await Promise.all([
    ctx.supabase
      .from("colaboradores")
      .select("id, nome, cargo, admissao, desligamento, contrato, fim_contrato, salario, adicionais, dependentes_ir, ferias_vencidas, saldo_fgts")
      .eq("empresa_id", empresaId)
      .or(`desligamento.is.null,desligamento.gte.${hoje}`)
      .order("nome"),
    ctx.supabase.from("calculo_parametros").select("anexo_servicos, rat, fap, terceiros").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("regime_tributario").eq("id", empresaId).single(),
  ]);
  const regimeAtual = regime.data?.regime_tributario ?? null;
  const p = parametros.data;
  const tipoFolha: TipoFolha =
    regimeAtual === "mei" ? "mei" : regimeAtual === "simples_nacional" ? (p?.anexo_servicos === "IV" ? "simples_iv" : "simples") : "geral";
  const colaboradores: ColaboradorSimulacao[] = (colabs.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    cargo: c.cargo,
    admissao: c.admissao,
    contrato: c.contrato as ColaboradorSimulacao["contrato"],
    fim_contrato: c.fim_contrato,
    salario: Number(c.salario),
    adicionais: Number(c.adicionais),
    dependentes_ir: c.dependentes_ir,
    ferias_vencidas: c.ferias_vencidas,
    saldo_fgts: c.saldo_fgts == null ? null : Number(c.saldo_fgts),
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Simulação de rescisão"
        descricao="Quanto custa desligar um colaborador, vários ou todos: verbas, FGTS, multa e encargos. É uma estimativa para planejamento."
      />
      {colabs.error ? <Alerta tom="perigo" className="mb-4">{mensagemErro(colabs.error)}</Alerta> : null}
      {!colaboradores.length && ctx.pode("colaboradores.gerenciar") ? (
        <Alerta tom="info" className="mb-4">
          Para simular com os dados de cada colaborador, cadastre-os em{" "}
          <Link href={`/e/${empresaId}/calculos/colaboradores`} className="font-medium underline">
            Colaboradores
          </Link>
          . Enquanto isso, use a simulação avulsa.
        </Alerta>
      ) : null}
      <SimuladorRescisao
        colaboradores={colaboradores}
        tipoFolha={tipoFolha}
        rat={Number(p?.rat ?? 2)}
        fap={Number(p?.fap ?? 1)}
        terceiros={Number(p?.terceiros ?? 5.8)}
        hoje={hoje}
      />
    </>
  );
}
