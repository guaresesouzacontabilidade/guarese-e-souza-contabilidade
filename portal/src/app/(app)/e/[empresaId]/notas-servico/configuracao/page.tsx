import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormConfiguracao, ServicosNfse, type ConfigNfse, type ServicoNfse } from "@/components/nfse/configuracao";
import { formatarData } from "@/lib/formatos";
import { certificadoValido } from "@/lib/nfse-emissao/rotulos";

export const metadata: Metadata = { title: "Configurar emissão de notas" };

export default async function ConfiguracaoNfse({ params }: PageProps<"/e/[empresaId]/notas-servico/configuracao">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfse.configurar")) return <Alerta tom="alerta">Somente a equipe do escritório configura a emissão de notas.</Alerta>;
  const base = `/e/${empresaId}`;

  const [{ data: cfg }, { data: servicos }, { data: emp }, { data: cert }] = await Promise.all([
    ctx.supabase.from("nfse_emissao_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("nfse_servicos").select("id, nome, codigo_tributacao_nacional, codigo_tributacao_municipal, codigo_nbs, descricao_padrao, ativo").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("empresas").select("regime_tributario, municipio_ibge, tipo_pessoa").eq("id", empresaId).maybeSingle(),
    ctx.supabase.from("certificados_digitais").select("valido_ate").eq("empresa_id", empresaId).is("revogado_em", null).maybeSingle(),
  ]);
  const codigo = cfg?.codigo_municipio ?? emp?.municipio_ibge ?? null;
  const { data: municipio } = codigo ? await ctx.supabase.from("municipios").select("nome, uf").eq("ibge", codigo).maybeSingle() : { data: null };
  const atual: ConfigNfse = {
    ativa: cfg?.ativa ?? false,
    ambiente: (cfg?.ambiente as ConfigNfse["ambiente"]) ?? "homologacao",
    codigo_municipio: codigo,
    inscricao_municipal: cfg?.inscricao_municipal ?? null,
    regime_apuracao_sn: cfg?.regime_apuracao_sn ?? 1,
    regime_especial: cfg?.regime_especial ?? 0,
    serie: cfg?.serie ?? 1,
    proximo_numero_homologacao: Number(cfg?.proximo_numero_homologacao ?? 1),
    proximo_numero_producao: Number(cfg?.proximo_numero_producao ?? 1),
    percentual_tributos_sn: cfg?.percentual_tributos_sn ?? null,
    percentual_tributos_federais: cfg?.percentual_tributos_federais ?? null,
    percentual_tributos_municipais: cfg?.percentual_tributos_municipais ?? null,
    iss_retencao_permitida: cfg?.iss_retencao_permitida ?? false,
    aliquota_iss_retencao: cfg?.aliquota_iss_retencao ?? null,
    enviar_email_tomador: cfg?.enviar_email_tomador ?? true,
    autorizacao_texto: cfg?.autorizacao_texto ?? null,
  };
  const certificadoOk = certificadoValido(cert?.valido_ate);

  return (
    <>
      <CabecalhoPagina
        titulo="Configurar emissão de notas"
        descricao="Dados que o portal usa para emitir a NFS-e desta empresa no Emissor Nacional."
        voltar={{ href: `${base}/notas-servico`, rotulo: "Notas de serviço" }}
      />
      {emp?.tipo_pessoa !== "PJ" ? <Alerta tom="alerta" className="mb-4">A emissão pelo portal está disponível para empresas (CNPJ).</Alerta> : null}
      <Alerta tom={certificadoOk ? "sucesso" : "alerta"} className="mb-4" titulo={certificadoOk ? "Certificado digital válido" : "Sem certificado digital válido"}>
        {certificadoOk ? (
          `O certificado A1 da empresa vale até ${formatarData(cert!.valido_ate)}. Ele assina as notas e faz a conexão com o Emissor Nacional.`
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Emissão</CardTitle>
            <CardDescription>Comece no ambiente de teste e passe para produção depois de conferir uma nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormConfiguracao empresaId={empresaId} cfg={atual} regime={emp?.regime_tributario ?? ""} municipioNome={municipio ? `${municipio.nome} / ${municipio.uf}` : null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Serviços da empresa</CardTitle>
            <CardDescription>O cliente escolhe um destes serviços no pedido; o código de tributação vai para a nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServicosNfse empresaId={empresaId} servicos={(servicos ?? []) as ServicoNfse[]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
