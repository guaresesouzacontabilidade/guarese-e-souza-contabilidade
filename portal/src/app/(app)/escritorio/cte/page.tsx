import type { Metadata } from "next";
import Link from "next/link";
import { Building2, PlugZap, Route } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { competenciaAtual, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "CT-e emitidos" };

interface Linha {
  empresa_id: string;
  empresa: string;
  documento: string | null;
  ativa: boolean;
  ambiente: string;
  autorizados: number;
  valor: number;
  cancelados: number;
  problemas: number;
  testes: number;
}

export default async function CteCarteira({ searchParams }: PageProps<"/escritorio/cte">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? competenciaAtual();
  const [{ data: cfgs, error }, { data: emissoes }] = await Promise.all([
    s.supabase.from("cte_config").select("empresa_id, ativa, ambiente, empresa:empresas(razao_social, nome_fantasia, documento)"),
    s.supabase
      .from("cte_emissoes")
      .select("empresa_id, situacao, ambiente, valor_total")
      .gte("created_at", `${comp}T00:00:00-03:00`)
      .lte("created_at", `${ultimoDiaDoMes(comp)}T23:59:59-03:00`)
      .limit(10000),
  ]);
  const linhas: Linha[] = (cfgs ?? [])
    .map((c) => {
      const e = c.empresa as { razao_social: string; nome_fantasia: string | null; documento: string } | null;
      const doMes = (emissoes ?? []).filter((x) => x.empresa_id === c.empresa_id);
      const prod = doMes.filter((x) => x.ambiente === "producao");
      const autorizados = prod.filter((x) => x.situacao === "autorizada" || x.situacao === "cancelando");
      return {
        empresa_id: c.empresa_id,
        empresa: e?.nome_fantasia ?? e?.razao_social ?? "—",
        documento: e?.documento ?? null,
        ativa: c.ativa,
        ambiente: c.ambiente,
        autorizados: autorizados.length,
        valor: autorizados.reduce((t, x) => t + Number(x.valor_total), 0),
        cancelados: prod.filter((x) => x.situacao === "cancelada").length,
        problemas: doMes.filter((x) => ["rejeitada", "denegada", "falha"].includes(x.situacao)).length,
        testes: doMes.length - prod.length,
      };
    })
    .sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR"));
  const total = linhas.reduce((t, l) => t + l.valor, 0);
  const problemas = linhas.reduce((t, l) => t + l.problemas, 0);

  return (
    <>
      <CabecalhoPagina
        titulo="CT-e emitidos"
        descricao="Emissão de CT-e (frete rodoviário) pelo portal em cada transportadora: conhecimentos do mês, recusas e a situação da configuração."
        acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={listaCompetencias(24, 0)} rotulo="Mês" />}
      />
      {error ? <Alerta tom="perigo">Não foi possível carregar: {mensagemErro(error)}</Alerta> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Empresas com emissão ligada" valor={linhas.filter((l) => l.ativa).length} icone={Building2} />
        <Indicador rotulo="Fretes autorizados no mês" valor={formatarMoeda(total)} tom="sucesso" icone={Route} detalhe="Só CT-e de produção." />
        <Indicador rotulo="Rejeitados ou sem resposta" valor={problemas} tom={problemas ? "alerta" : "neutro"} />
      </div>
      <Card>
        <CardContent className="p-0 sm:p-0">
          {linhas.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Emissão</Th>
                  <Th className="text-right">CT-e</Th>
                  <Th className="text-right">Fretes</Th>
                  <Th className="hidden md:table-cell">Rejeitados / sem resposta</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.empresa_id}>
                    <Td>
                      <Link href={`/e/${l.empresa_id}/cte?competencia=${comp.slice(0, 7)}`} className="font-medium underline-offset-4 hover:underline">
                        {l.empresa}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{formatarDocumento(l.documento)}</span>
                    </Td>
                    <Td>
                      {l.ativa ? <Badge variante={l.ambiente === "producao" ? "sucesso" : "info"}>{l.ambiente === "producao" ? "Produção" : "Teste"}</Badge> : <Badge>Desligada</Badge>}
                    </Td>
                    <Td className="text-right numero">
                      {l.autorizados}
                      {l.cancelados ? <span className="block text-xs text-muted-foreground">{l.cancelados} cancelado(s)</span> : null}
                      {l.testes ? <span className="block text-xs text-muted-foreground">{l.testes} de teste</span> : null}
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(l.valor)}</Td>
                    <Td className="hidden md:table-cell">{l.problemas ? <Badge variante="alerta">{l.problemas}</Badge> : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={PlugZap}
              titulo="Nenhuma transportadora com emissão de CT-e configurada"
              descricao="Abra a empresa, vá em Emitir CT-e (frete) → Configurar emissão, escolha o estabelecimento, informe o RNTRC, cadastre as operações do frete e ligue a emissão (com o certificado digital)."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
