import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmitentesNfe, type ClasseIbsCbs, type EmitenteNfe } from "@/components/nfe/configuracao";
import { FormConfiguracaoCte, OperacoesCte, type ConfigCte, type OperacaoCte } from "@/components/cte/configuracao";
import { mensagemErro } from "@/lib/acoes";
import { formatarData } from "@/lib/formatos";
import { certificadoValido } from "@/lib/nfe-emissao/rotulos";

export const metadata: Metadata = { title: "Configurar emissão de CT-e" };

function Passo({ feito, children }: { feito: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {feito ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span className={feito ? "text-muted-foreground" : undefined}>{children}</span>
    </li>
  );
}

export default async function ConfiguracaoCte({ params }: PageProps<"/e/[empresaId]/cte/configuracao">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("cte.configurar")) return <Alerta tom="alerta">Somente a equipe do escritório configura a emissão de CT-e.</Alerta>;
  const base = `/e/${empresaId}`;

  const [{ data: cfg, error }, { data: emp }, { data: cert }, { data: emitentes }, { data: operacoes }, { data: classes }] = await Promise.all([
    ctx.supabase.from("cte_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("tipo_pessoa, regime_tributario").eq("id", empresaId).maybeSingle(),
    ctx.supabase.from("certificados_digitais").select("valido_ate").eq("empresa_id", empresaId).is("revogado_em", null).maybeSingle(),
    ctx.supabase.from("nfe_emitentes").select("*, municipio:municipios(nome, uf)").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("cte_operacoes").select("*").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("nfe_cclass_trib").select("cclass_trib, cst, nome, p_red_ibs, p_red_cbs").order("cclass_trib"),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar a configuração: {mensagemErro(error)}</Alerta>;

  const regimeSimples = emp?.regime_tributario === "simples_nacional" || emp?.regime_tributario === "mei";
  const atual: ConfigCte = {
    ativa: cfg?.ativa ?? false,
    ambiente: (cfg?.ambiente as ConfigCte["ambiente"]) ?? "homologacao",
    crt: cfg?.crt ?? (emp?.regime_tributario === "mei" ? 4 : regimeSimples ? 1 : 3),
    emitente_id: cfg?.emitente_id ?? null,
    serie: cfg?.serie ?? 1,
    proximo_numero_homologacao: Number(cfg?.proximo_numero_homologacao ?? 1),
    proximo_numero_producao: Number(cfg?.proximo_numero_producao ?? 1),
    rntrc: cfg?.rntrc ?? null,
    autorizar_escritorio_xml: cfg?.autorizar_escritorio_xml ?? true,
    informacoes_padrao: cfg?.informacoes_padrao ?? null,
    autorizacao_texto: cfg?.autorizacao_texto ?? null,
  };
  const simples = atual.crt === 1 || atual.crt === 4;
  const certificadoOk = certificadoValido(cert?.valido_ate);
  const listaEmitentes: EmitenteNfe[] = (emitentes ?? []).map((e) => {
    const m = e.municipio as { nome?: string; uf?: string } | null;
    return { ...e, municipio: m?.nome ?? null, uf: m?.uf ?? null, proximo_numero_homologacao: Number(e.proximo_numero_homologacao), proximo_numero_producao: Number(e.proximo_numero_producao) };
  });
  const listaOperacoes = (operacoes ?? []) as unknown as OperacaoCte[];
  const operacoesSemRegra = listaOperacoes.filter((o) => o.ativa && (simples ? o.icms_cst !== "sn" : o.icms_cst === "sn"));
  const emiteNfe = ctx.pode("nfe.configurar");

  return (
    <>
      <CabecalhoPagina
        titulo="Configurar emissão de CT-e"
        descricao="Estabelecimento que emite, RNTRC, série e numeração, e as operações do frete com as regras fiscais. Quem emite o CT-e só escolhe a operação, as partes e a carga."
        voltar={{ href: `${base}/cte`, rotulo: "CT-e (frete)" }}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Alerta tom={certificadoOk ? "sucesso" : "alerta"} titulo={certificadoOk ? "Certificado digital válido" : "Sem certificado digital válido"}>
          {certificadoOk ? (
            `O certificado A1 vale até ${formatarData(cert!.valido_ate)}. Ele assina o CT-e e faz a conexão com a SEFAZ.`
          ) : (
            <>
              A emissão só liga com o certificado A1 da empresa.{" "}
              <Link href={`${base}/notas-automaticas`} className="font-medium underline">
                Cadastrar o certificado
              </Link>
              .
            </>
          )}
        </Alerta>
        <Card>
          <CardContent className="pt-4">
            <p className="mb-2 text-sm font-medium">Para ligar a emissão</p>
            <ul className="space-y-1.5">
              <Passo feito={certificadoOk}>Certificado digital A1 da empresa</Passo>
              <Passo feito={Boolean(atual.emitente_id)}>Estabelecimento (inscrição estadual) escolhido</Passo>
              <Passo feito={Boolean(atual.rntrc)}>RNTRC da transportadora</Passo>
              <Passo feito={listaOperacoes.some((o) => o.ativa)}>Operação do frete com as regras fiscais</Passo>
              <Passo feito={Boolean(atual.autorizacao_texto)}>Autorização do cliente registrada</Passo>
              <Passo feito={atual.ativa}>Emissão ligada (comece em teste)</Passo>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Alerta tom="info" className="mb-4" titulo="Credenciamento na SEFAZ">
        A transportadora precisa estar credenciada como emissora de CT-e na SEFAZ do estado. Sem o credenciamento, a SEFAZ recusa o CT-e. Depois de salvar, use &quot;Testar
        conexão com a SEFAZ&quot; e emita um CT-e de teste antes de passar para produção. O MDF-e (manifesto da viagem) não é emitido pelo portal.
      </Alerta>

      {operacoesSemRegra.length ? (
        <Alerta tom="alerta" className="mb-4" titulo="Operações que não combinam com o regime">
          {operacoesSemRegra.map((o) => o.nome).join(", ")}: {simples ? "no Simples Nacional o ICMS do CT-e é “Simples Nacional”." : "fora do Simples, escolha o CST do ICMS."} Edite
          antes de emitir.
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Emissão</CardTitle>
            <CardDescription>Comece no ambiente de teste e passe para produção depois de conferir um CT-e.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormConfiguracaoCte
              empresaId={empresaId}
              cfg={atual}
              estabelecimentos={listaEmitentes.filter((e) => e.ativo).map((e) => ({ id: e.id, nome: e.nome, inscricao_estadual: e.inscricao_estadual, municipio: e.municipio, uf: e.uf }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Estabelecimentos</CardTitle>
            <CardDescription>A inscrição estadual e o endereço da transportadora (o mesmo cadastro usado na NF-e).</CardDescription>
          </CardHeader>
          <CardContent>
            {emiteNfe ? (
              <EmitentesNfe empresaId={empresaId} emitentes={listaEmitentes} pessoaFisica={emp?.tipo_pessoa === "PF"} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {listaEmitentes.length
                  ? listaEmitentes.map((e) => `${e.nome} — IE ${e.inscricao_estadual}`).join("; ")
                  : "Nenhum estabelecimento cadastrado. O cadastro é feito por quem configura a NF-e."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Operações do frete (regras fiscais)</CardTitle>
          <CardDescription>CFOP, ICMS (com redução, isenção, substituição ou crédito presumido) e IBS/CBS. O cálculo de cada CT-e sai destas regras.</CardDescription>
        </CardHeader>
        <CardContent>
          <OperacoesCte empresaId={empresaId} operacoes={listaOperacoes} simples={simples} classes={(classes ?? []) as ClasseIbsCbs[]} />
        </CardContent>
      </Card>
    </>
  );
}
