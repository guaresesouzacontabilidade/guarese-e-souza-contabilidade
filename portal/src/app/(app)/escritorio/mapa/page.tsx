import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { MapaCarteira } from "@/components/operacional/mapa-carteira";
import { parametro } from "@/lib/busca";
import { competenciaAtual, hojeISO, lerCompetencia, somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";
import { montarEmpresaMapa, type LinhaMapaBanco } from "@/lib/operacional/mapa";

export const metadata: Metadata = { title: "Mapa da carteira" };

export default async function MapaDaCarteira({ searchParams }: PageProps<"/escritorio/mapa">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const atual = competenciaAtual();
  // O mês de trabalho é o anterior (em novembro a equipe fecha outubro)
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(atual, -1);
  const hoje = hojeISO();

  const { data, error } = await s.supabase.rpc("operacional_mapa", { p_competencia: comp });
  const empresas = ((data ?? []) as LinhaMapaBanco[]).map((l) => montarEmpresaMapa(l, comp, hoje, atual));

  const mes = (n: number) => `/escritorio/mapa?competencia=${somarMeses(comp, n).slice(0, 7)}`;
  const prazosEm = formatarCompetencia(somarMeses(comp, 1), true).toLowerCase();

  return (
    <>
      <CabecalhoPagina
        titulo="Mapa da carteira"
        descricao="Onde cada empresa está no mês, etapa por etapa. Clique em um quadradinho para ver o que falta e resolver ali mesmo."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              <Button asChild variante="fantasma" className="size-10 p-0" aria-label="Mês anterior">
                <Link href={mes(-1)}>
                  <ChevronLeft />
                </Link>
              </Button>
              <div className="min-w-[150px] px-2 text-center leading-tight">
                <p className="text-sm font-semibold text-titulo">{formatarCompetencia(comp, true)}</p>
                <p className="text-xs text-muted-foreground">prazos em {prazosEm.split(" de ")[0]}</p>
              </div>
              <Button asChild variante="fantasma" className="size-10 p-0" aria-label="Próximo mês">
                <Link href={mes(1)}>
                  <ChevronRight />
                </Link>
              </Button>
            </div>
            <Button asChild variante="contorno">
              <a href={`/api/escritorio/mapa/planilha?competencia=${comp.slice(0, 7)}`}>
                <Download /> Baixar planilha
              </a>
            </Button>
          </div>
        }
      />
      {error ? (
        <Alerta tom="perigo">Não foi possível montar o mapa: {mensagemErro(error)}</Alerta>
      ) : (
        <MapaCarteira key={comp} competencia={comp} empresas={empresas} usuarioId={s.perfil.id} />
      )}
    </>
  );
}
