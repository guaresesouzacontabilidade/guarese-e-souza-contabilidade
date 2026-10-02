import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { FormNovoRelatorio } from "@/components/relatorios/acoes-relatorio";
import { TIPOS_RELATORIO } from "@/lib/relatorios/snapshot";
import { lerPeriodo, opcoesPeriodo } from "@/lib/relatorios/periodo";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";

export const metadata: Metadata = { title: "Preparar relatório" };

export default async function NovoRelatorio({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios/publicados/novo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.publicar")) return <Alerta tom="alerta">Somente a equipe do escritório pode preparar relatórios.</Alerta>;
  const hoje = hojeISO();
  const periodo = lerPeriodo(parametro(sp, "periodo"), hoje);
  return (
    <>
      <CabecalhoPagina
        titulo="Preparar relatório para o cliente"
        descricao="Gera um rascunho com os números do período. Nada é enviado ao cliente até você publicar."
        voltar={{ href: `/e/${empresaId}/relatorios/publicados`, rotulo: "Relatórios do escritório" }}
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <FormNovoRelatorio
            empresaId={empresaId}
            tipos={Object.entries(TIPOS_RELATORIO).map(([valor, t]) => ({ valor, rotulo: t.rotulo, descricao: t.descricao }))}
            opcoes={opcoesPeriodo(hoje)}
            periodoInicial={periodo.chave}
          />
        </CardContent>
      </Card>
    </>
  );
}
