import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSignature, Plus, ShieldCheck } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelarDeclaracao, EnviarDeclaracaoAssinada } from "@/components/declaracoes/acoes-declaracao";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { codigoDeclaracao } from "@/lib/declaracoes/codigo";

export const metadata: Metadata = { title: "Declarações" };

export default async function Declaracoes({ params, searchParams }: PageProps<"/e/[empresaId]/declaracoes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.ver")) return <Alerta tom="alerta">Seu acesso não inclui as declarações desta empresa.</Alerta>;
  const equipe = ctx.pode("relatorios.publicar");
  const podeEnviarAssinada = equipe || ctx.pode("documentos.enviar");
  const base = `/e/${empresaId}/declaracoes`;
  const { data: lista } = await ctx.supabase
    .from("declaracoes_faturamento")
    .select("id, periodo_inicio, periodo_fim, total, data_declaracao, situacao, assinatura_digital, assinada_em, criado_em, finalidade, motivo_cancelamento")
    .eq("empresa_id", empresaId)
    .order("criado_em", { ascending: false })
    .limit(100);

  return (
    <>
      <CabecalhoPagina
        titulo="Declarações"
        descricao="Declaração de faturamento emitida pelo escritório, com a logo do escritório e da empresa, pronta para assinar e entregar (banco, aluguel, licitação, fornecedor...)."
        acoes={
          equipe ? (
            <Button asChild>
              <Link href={`${base}/nova`}>
                <Plus /> Nova declaração de faturamento
              </Link>
            </Button>
          ) : undefined
        }
      />
      {typeof sp.emitida === "string" ? (
        <Alerta tom="sucesso" className="mb-4" titulo="Declaração emitida">
          Baixe o PDF, colha as assinaturas do representante legal e do contador e depois envie aqui a versão assinada.
        </Alerta>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Como assinar
          </CardTitle>
          <CardDescription>
            1. Baixe o PDF. 2. O representante legal e o contador assinam: com certificado digital (e-CPF), pelo gov.br — grátis, em
            assinador.iti.br — ou à mão, digitalizando depois. 3. Envie aqui o PDF assinado: ele fica guardado para o escritório e para a empresa.
            O portal não assina em nome de ninguém.
          </CardDescription>
        </CardHeader>
      </Card>

      {lista?.length ? (
        <ul className="space-y-3">
          {lista.map((d) => {
            const periodo = `${formatarCompetencia(d.periodo_inicio, true)} a ${formatarCompetencia(d.periodo_fim, true)}`;
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{periodo.charAt(0).toUpperCase() + periodo.slice(1)}</p>
                        <p className="text-xs text-muted-foreground">
                          Código {codigoDeclaracao(d.id)} · emitida em {formatarDataHora(d.criado_em)} · data da declaração {formatarData(d.data_declaracao)}
                          {d.finalidade ? ` · ${d.finalidade}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="numero text-lg font-semibold">{formatarMoeda(d.total)}</p>
                        {d.situacao === "cancelada" ? (
                          <Badge variante="perigo">Cancelada</Badge>
                        ) : d.situacao === "assinada" ? (
                          <Badge variante="sucesso">Assinada</Badge>
                        ) : (
                          <Badge variante="alerta">Aguardando assinaturas</Badge>
                        )}
                      </div>
                    </div>
                    {d.situacao === "assinada" ? (
                      <p className="text-xs text-muted-foreground">
                        Versão assinada enviada em {formatarDataHora(d.assinada_em)} ·{" "}
                        {d.assinatura_digital ? "com assinatura digital (confira a validade em validar.iti.gov.br)" : "sem assinatura digital"}
                      </p>
                    ) : null}
                    {d.situacao === "cancelada" && d.motivo_cancelamento ? <p className="text-xs text-muted-foreground">Motivo: {d.motivo_cancelamento}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variante="contorno" tamanho="sm">
                        <a href={`/api/declaracoes/${d.id}/pdf`}>
                          <Download /> PDF para assinar
                        </a>
                      </Button>
                      {d.situacao === "assinada" ? (
                        <Button asChild variante="contorno" tamanho="sm">
                          <a href={`/api/declaracoes/${d.id}/assinada`}>
                            <FileSignature /> Baixar a assinada
                          </a>
                        </Button>
                      ) : null}
                      {podeEnviarAssinada && d.situacao !== "cancelada" ? (
                        <EnviarDeclaracaoAssinada empresaId={empresaId} declaracaoId={d.id} substituir={d.situacao === "assinada"} />
                      ) : null}
                      {equipe ? (
                        <Button asChild variante="fantasma" tamanho="sm">
                          <Link href={`${base}/nova?de=${d.id}`}>Usar como base</Link>
                        </Button>
                      ) : null}
                      {equipe && d.situacao !== "cancelada" ? <CancelarDeclaracao empresaId={empresaId} declaracaoId={d.id} /> : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <EstadoVazio
          icone={FileSignature}
          titulo="Nenhuma declaração emitida"
          descricao={equipe ? "Emita a primeira: escolha o período (por exemplo, os últimos 12 meses) e confira os valores." : "As declarações emitidas pelo escritório aparecem aqui."}
        />
      )}
    </>
  );
}
