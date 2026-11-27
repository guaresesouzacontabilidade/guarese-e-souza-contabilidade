import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, ImageIcon } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Campo, Select } from "@/components/ui/form";
import { FormDeclaracao, type PadroesDeclaracao } from "@/components/declaracoes/form-declaracao";
import { MAXIMO_MESES, mesesDoPeriodo, sugerirValores, ultimos12Meses, type FaturamentoMes } from "@/lib/declaracoes/faturamento";
import { DadosReceitaSchema, funcaoDoSocio } from "@/lib/empresas/receita";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarCpf } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Nova declaração de faturamento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NovaDeclaracao({ params, searchParams }: PageProps<"/e/[empresaId]/declaracoes/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const base = `/e/${empresaId}/declaracoes`;
  if (!ctx.pode("relatorios.publicar")) return <Alerta tom="alerta">Só a equipe do escritório emite declarações.</Alerta>;

  // Base: uma declaração anterior (?de=), para corrigir ou repetir com outro período
  const de = typeof sp.de === "string" && UUID.test(sp.de) ? sp.de : null;
  const { data: anterior } = de
    ? await ctx.supabase.from("declaracoes_faturamento").select("*").eq("id", de).eq("empresa_id", empresaId).maybeSingle()
    : { data: null };

  // Período: padrão, os 12 meses fechados antes do mês atual
  const padrao = ultimos12Meses(competenciaAtual());
  let inicio = lerCompetencia(typeof sp.inicio === "string" ? sp.inicio : null) ?? anterior?.periodo_inicio ?? padrao.inicio;
  let fim = lerCompetencia(typeof sp.fim === "string" ? sp.fim : null) ?? anterior?.periodo_fim ?? padrao.fim;
  if (fim < inicio) [inicio, fim] = [fim, inicio];
  const limitado = mesesDoPeriodo(inicio, fim).length > MAXIMO_MESES;
  if (limitado) fim = somarMeses(inicio, MAXIMO_MESES - 1);

  const [{ data: dados, error }, { data: empresa }, { data: contatos }, { data: escritorio }] = await Promise.all([
    ctx.supabase.rpc("faturamento_mensal", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }),
    ctx.supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, cidade, uf, dados_receita, logo_path, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
      .eq("id", empresaId)
      .single(),
    ctx.supabase.from("empresa_contatos").select("nome, funcao, principal").eq("empresa_id", empresaId).order("principal", { ascending: false }).order("nome"),
    ctx.supabase.from("escritorio").select("cidade, uf, contador_nome, contador_crc, logo_path").eq("id", 1).maybeSingle(),
  ]);

  let meses = sugerirValores((dados ?? []) as unknown as FaturamentoMes[]);
  if (anterior) {
    const salvos = new Map((anterior.meses as { competencia: string; valor: number | string }[]).map((m) => [m.competencia.slice(0, 10), m.valor]));
    meses = meses.map((m) =>
      salvos.has(m.competencia) ? { ...m, valor: Number(salvos.get(m.competencia)).toFixed(2), origem: "digitado", detalhe: "valor da declaração usada como base" } : m,
    );
  }

  // Representante legal: o sócio administrador dos contatos ou dos dados da Receita
  const receita = empresa?.dados_receita ? DadosReceitaSchema.safeParse(empresa.dados_receita) : null;
  const socioAdm = receita?.success ? receita.data.socios.find((s) => funcaoDoSocio(s.qualificacao) === "socio_administrador") : undefined;
  const contatoAdm = (contatos ?? []).find((c) => c.funcao === "socio_administrador");
  const contadorPerfil = (empresa?.contador as unknown as { nome: string } | null)?.nome ?? "";
  const padroes: PadroesDeclaracao = {
    representante_nome: anterior?.representante_nome ?? contatoAdm?.nome ?? socioAdm?.nome ?? "",
    representante_cpf: anterior?.representante_cpf ? formatarCpf(anterior.representante_cpf) : "",
    representante_cargo: anterior?.representante_cargo ?? (contatoAdm || socioAdm ? "Sócio administrador" : ""),
    contador_nome: anterior?.contador_nome ?? escritorio?.contador_nome ?? contadorPerfil,
    contador_crc: anterior?.contador_crc ?? escritorio?.contador_crc ?? "",
    cidade: anterior?.cidade ?? escritorio?.cidade ?? empresa?.cidade ?? "",
    uf: anterior?.uf ?? escritorio?.uf ?? empresa?.uf ?? "",
    data_declaracao: hojeISO(),
    finalidade: anterior?.finalidade ?? "",
    observacao: anterior?.observacao ?? "",
  };
  const opcoes = listaCompetencias(60, 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Nova declaração de faturamento"
        descricao={`${empresa?.razao_social ?? ""} — escolha o período, confira os valores de cada mês e emita o PDF para assinar.`}
        voltar={{ href: base, rotulo: "Declarações" }}
      />
      {anterior ? (
        <Alerta tom="info" className="mb-4">
          Usando como base a declaração de {formatarCompetencia(anterior.periodo_inicio, true)} a {formatarCompetencia(anterior.periodo_fim, true)}: os
          valores e os dados dela já estão preenchidos.
        </Alerta>
      ) : null}
      {limitado ? (
        <Alerta tom="alerta" className="mb-4">
          A declaração vai até {MAXIMO_MESES} meses: o período foi encurtado para terminar em {formatarCompetencia(fim, true)}.
        </Alerta>
      ) : null}
      {error ? (
        <Alerta tom="perigo" className="mb-4">
          {mensagemErro(error)}
        </Alerta>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="size-4" /> Período
            </CardTitle>
            <CardDescription>
              {meses.length} {meses.length === 1 ? "mês" : "meses"}: de {formatarCompetencia(inicio, true)} a {formatarCompetencia(fim, true)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-3">
              {de ? <input type="hidden" name="de" value={de} /> : null}
              <Campo rotulo="De" htmlFor="periodo-inicio" className="w-full max-w-48">
                <Select id="periodo-inicio" name="inicio" defaultValue={inicio.slice(0, 7)}>
                  {opcoes.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Até" htmlFor="periodo-fim" className="w-full max-w-48">
                <Select id="periodo-fim" name="fim" defaultValue={fim.slice(0, 7)}>
                  {opcoes.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Button type="submit" variante="contorno">
                Trocar o período
              </Button>
              <Button asChild variante="fantasma">
                <Link href={`${base}/nova${de ? `?de=${de}&inicio=${padrao.inicio.slice(0, 7)}&fim=${padrao.fim.slice(0, 7)}` : ""}`}>Últimos 12 meses</Link>
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4" /> Logos no PDF
            </CardTitle>
            <CardDescription>
              Escritório: {escritorio?.logo_path ? "logo enviada nas configurações" : "logo oficial do portal"}.
              <br />
              Empresa:{" "}
              {empresa?.logo_path ? (
                "logo do cadastro"
              ) : (
                <>
                  sem logo —{" "}
                  <Link href={`/escritorio/empresas/${empresaId}`} className="text-primary hover:underline">
                    envie no cadastro da empresa
                  </Link>
                  .
                </>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <FormDeclaracao key={`${inicio}-${fim}-${de ?? ""}`} empresaId={empresaId} periodo={{ inicio, fim }} meses={meses} padroes={padroes} />
        </CardContent>
      </Card>
    </>
  );
}
