import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { MODELOS, tamanhoCiclo, type ModeloEscala } from "@/lib/escalas/modelos";
import { cn } from "@/lib/utils";
import { NavegacaoEscalas } from "../navegacao";

export const metadata: Metadata = { title: "Modelos de escala" };

const RISCO = {
  baixo: { texto: "Uso comum", variante: "sucesso" as const },
  medio: { texto: "Pede documento", variante: "alerta" as const },
  alto: { texto: "Risco alto", variante: "perigo" as const },
};

/** Duas semanas de exemplo: ■ trabalho, □ folga. */
function Exemplo({ m }: { m: ModeloEscala }) {
  const dias = 14;
  let marcas: boolean[];
  if (m.ciclo) {
    const tam = tamanhoCiclo(m);
    marcas = Array.from({ length: dias }, (_, i) => i % tam < m.ciclo!.trabalho);
  } else if (m.chave === "parcial" || m.chave === "personalizada" || m.chave === "5x2") {
    marcas = Array.from({ length: dias }, (_, i) => i % 7 < 5);
  } else if (m.chave === "4x3") {
    marcas = Array.from({ length: dias }, (_, i) => i % 7 < 4);
  } else {
    marcas = Array.from({ length: dias }, (_, i) => i % 7 !== 6);
  }
  const nomes = ["S", "T", "Q", "Q", "S", "S", "D"];
  return (
    <div aria-label="Exemplo de duas semanas: dias escuros são de trabalho, claros são folga" role="img" className="flex flex-wrap gap-1">
      {marcas.map((t, i) => (
        <span key={i} className={cn("inline-flex size-6 items-center justify-center rounded text-[10px]", t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {m.ciclo ? i + 1 : nomes[i % 7]}
        </span>
      ))}
    </div>
  );
}

export default async function PaginaModelosEscala({ params }: PageProps<"/e/[empresaId]/escalas/modelos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("escalas.gerenciar") && !ctx.pode("escalas.ver")) notFound();
  return (
    <>
      <CabecalhoPagina titulo="Modelos de escala" descricao="As escalas usadas no mercado de trabalho, como funcionam, para quem servem e o que a lei pede em cada uma." />
      <NavegacaoEscalas empresaId={empresaId} gerenciar={ctx.pode("escalas.gerenciar")} />
      <Alerta tom="info" className="mb-5">
        Valem para todas: até 8 horas por dia e 44 por semana (salvo os regimes especiais), 11 horas de descanso entre uma jornada e outra, folga semanal até o 7º dia,
        domingo de folga de tempos em tempos e intervalo para refeição. A convenção coletiva da categoria pode ter regras próprias.
      </Alerta>
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {MODELOS.map((m) => (
          <Card key={m.chave} id={m.chave}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">{m.nome}</CardTitle>
                <Badge variante={RISCO[m.risco].variante}>{RISCO[m.risco].texto}</Badge>
              </div>
              <CardDescription>{m.resumo}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Exemplo m={m} />
              <p>{m.comoFunciona}</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Jornada típica</dt>
                  <dd>{m.jornadaTipica}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Indicada para</dt>
                  <dd>{m.indicadoPara}</dd>
                </div>
              </dl>
              {m.exige.length ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">O que a lei pede</p>
                  <ul className="list-disc pl-5">
                    {m.exige.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {m.atencao.length ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Cuidados</p>
                  <ul className="list-disc pl-5">
                    {m.atencao.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-muted-foreground">Base legal</p>
                <ul className="space-y-0.5">
                  {m.base.map((b) => (
                    <li key={b.texto}>
                      {b.url ? (
                        <a href={b.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {b.texto} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        b.texto
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
