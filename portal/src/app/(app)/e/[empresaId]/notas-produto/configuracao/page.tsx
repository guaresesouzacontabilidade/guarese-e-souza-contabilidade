import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmitentesNfe,
  FormConfiguracaoNfe,
  OperacoesNfe,
  ProdutosNfe,
  type ClasseIbsCbs,
  type ConfigNfe,
  type EmitenteNfe,
  type OperacaoNfe,
  type ProdutoNfe,
} from "@/components/nfe/configuracao";
import { mensagemErro } from "@/lib/acoes";
import { formatarData } from "@/lib/formatos";
import { certificadoValido } from "@/lib/nfe-emissao/rotulos";

export const metadata: Metadata = { title: "Configurar emissão de NF-e" };

function Passo({ feito, children }: { feito: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {feito ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span className={feito ? "text-muted-foreground" : undefined}>{children}</span>
    </li>
  );
}

export default async function ConfiguracaoNfe({ params }: PageProps<"/e/[empresaId]/notas-produto/configuracao">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfe.configurar")) return <Alerta tom="alerta">Somente a equipe do escritório configura a emissão de NF-e.</Alerta>;
  const base = `/e/${empresaId}`;

  const [{ data: cfg }, { data: emp }, { data: cert }, { data: emitentes, error }, { data: produtos }, { data: operacoes }, { data: classes }] = await Promise.all([
    ctx.supabase.from("nfe_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("tipo_pessoa, regime_tributario").eq("id", empresaId).maybeSingle(),
    ctx.supabase.from("certificados_digitais").select("valido_ate").eq("empresa_id", empresaId).is("revogado_em", null).maybeSingle(),
    ctx.supabase.from("nfe_emitentes").select("*, municipio:municipios(nome, uf)").eq("empresa_id", empresaId).order("serie"),
    ctx.supabase.from("nfe_produtos").select("*").eq("empresa_id", empresaId).order("descricao"),
    ctx.supabase.from("nfe_operacoes").select("*").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("nfe_cclass_trib").select("cclass_trib, cst, nome, p_red_ibs, p_red_cbs").order("cclass_trib"),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar a configuração: {mensagemErro(error)}</Alerta>;

  const pessoaFisica = emp?.tipo_pessoa === "PF";
  const regimeSimples = emp?.regime_tributario === "simples_nacional" || emp?.regime_tributario === "mei";
  const atual: ConfigNfe = {
    ativa: cfg?.ativa ?? false,
    ambiente: (cfg?.ambiente as ConfigNfe["ambiente"]) ?? "homologacao",
    crt: cfg?.crt ?? (emp?.regime_tributario === "mei" ? 4 : regimeSimples ? 1 : 3),
    presenca: cfg?.presenca ?? 9,
    funrural_percentual: cfg?.funrural_percentual ?? null,
    funrural_modo: cfg?.funrural_modo ?? null,
    enviar_email_destinatario: cfg?.enviar_email_destinatario ?? true,
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
  const listaOperacoes = (operacoes ?? []).map((o) => ({ ...o, contribuicoes: Array.isArray(o.contribuicoes) ? o.contribuicoes : [] })) as unknown as OperacaoNfe[];
  const operacoesSemRegra = listaOperacoes.filter((o) => o.ativa && (simples ? !["101", "102", "103", "300", "400", "900"].includes(o.icms_cst) : ["101", "102", "103", "300", "400", "900"].includes(o.icms_cst) || (atual.crt === 3 && !o.ibscbs_cclass_trib)));

  return (
    <>
      <CabecalhoPagina
        titulo="Configurar emissão de NF-e"
        descricao="Quem emite (inscrições e séries), os produtos e as operações com as regras fiscais. Quem emite a nota só escolhe a operação, o cliente e os produtos."
        voltar={{ href: `${base}/notas-produto`, rotulo: "Notas de produto" }}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Alerta tom={certificadoOk ? "sucesso" : "alerta"} titulo={certificadoOk ? "Certificado digital válido" : "Sem certificado digital válido"}>
          {certificadoOk ? (
            `O certificado A1 vale até ${formatarData(cert!.valido_ate)}. Ele assina as notas e faz a conexão com a SEFAZ.`
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
              <Passo feito={listaEmitentes.some((e) => e.ativo)}>{pessoaFisica ? "Inscrição estadual de cada propriedade, com a série" : "Inscrição estadual e série"}</Passo>
              <Passo feito={listaOperacoes.some((o) => o.ativa)}>Operação com as regras fiscais</Passo>
              <Passo feito={(produtos ?? []).some((p) => p.ativo)}>Produtos (NCM, unidade e peso)</Passo>
              <Passo feito={Boolean(atual.autorizacao_texto)}>Autorização do cliente registrada</Passo>
              <Passo feito={atual.ativa}>Emissão ligada (comece em teste)</Passo>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Alerta tom="info" className="mb-4" titulo="Credenciamento na SEFAZ">
        A empresa (ou o produtor) precisa estar credenciada como emissora de NF-e na SEFAZ do estado. Sem o credenciamento, a SEFAZ recusa a nota (rejeição 203). Depois de
        salvar, use &quot;Testar conexão com a SEFAZ&quot; e emita uma nota de teste antes de passar para produção.
      </Alerta>

      {operacoesSemRegra.length ? (
        <Alerta tom="alerta" className="mb-4" titulo="Operações que não combinam com o regime">
          {operacoesSemRegra.map((o) => o.nome).join(", ")}: {simples ? "o Simples usa CSOSN no ICMS." : "o regime normal usa CST no ICMS e exige a classificação do IBS/CBS."} Edite antes de emitir.
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Emissão</CardTitle>
            <CardDescription>Comece no ambiente de teste e passe para produção depois de conferir uma nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormConfiguracaoNfe empresaId={empresaId} cfg={atual} pessoaFisica={pessoaFisica} />
          </CardContent>
        </Card>
        <div className="space-y-4 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>{pessoaFisica ? "Propriedades (quem emite)" : "Quem emite"}</CardTitle>
              <CardDescription>
                {pessoaFisica
                  ? "O produtor emite com o CPF e a inscrição estadual de cada propriedade, cada uma com a própria série."
                  : "A inscrição estadual do estabelecimento, com a série e a numeração da NF-e."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmitentesNfe empresaId={empresaId} emitentes={listaEmitentes} pessoaFisica={pessoaFisica} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Produtos</CardTitle>
              <CardDescription>O que a empresa vende, com NCM, unidade e peso.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProdutosNfe empresaId={empresaId} produtos={(produtos ?? []) as ProdutoNfe[]} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Operações (regras fiscais)</CardTitle>
          <CardDescription>
            CFOP, ICMS, DIFAL, ICMS do frete, PIS/Cofins, IBS/CBS, FUNRURAL e contribuições como o FETHAB. As guias de cada nota saem destas regras.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OperacoesNfe empresaId={empresaId} operacoes={listaOperacoes} simples={simples} classes={(classes ?? []) as ClasseIbsCbs[]} />
        </CardContent>
      </Card>
    </>
  );
}
