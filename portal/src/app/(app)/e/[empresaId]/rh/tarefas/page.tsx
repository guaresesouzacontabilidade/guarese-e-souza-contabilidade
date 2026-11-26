import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks, Settings2 } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { QuadroTarefas } from "@/components/rh/quadro";
import { RotinasIniciais } from "@/components/rh/modelos";
import {
  carregarCargos,
  carregarFuncionarios,
  carregarModelos,
  carregarQuadro,
  obterContextoRh,
} from "@/lib/rh/dados";

export const metadata: Metadata = { title: "Tarefas da equipe" };

export default async function PaginaTarefas({
  params,
}: PageProps<"/e/[empresaId]/rh/tarefas">) {
  const { empresaId } = await params;
  const ctx = await obterContextoRh(empresaId);
  if (!ctx.gestor && !ctx.fazTarefas) notFound();
  const [tarefas, funcionarios, cargos, modelos] = await Promise.all([
    carregarQuadro(ctx.supabase, empresaId),
    ctx.gestor
      ? carregarFuncionarios(ctx.supabase, empresaId)
      : Promise.resolve([]),
    ctx.gestor ? carregarCargos(ctx.supabase, empresaId) : Promise.resolve([]),
    ctx.gestor ? carregarModelos(ctx.supabase, empresaId) : Promise.resolve([]),
  ]);
  const base = `/e/${empresaId}/rh/tarefas`;

  return (
    <>
      <CabecalhoPagina
        titulo={ctx.gestor ? "Tarefas da equipe" : "Minhas tarefas"}
        descricao={
          ctx.gestor
            ? "As rotinas da equipe no quadro: quem faz, o prazo e o andamento de cada uma."
            : "As tarefas atribuídas a você. Conclua aqui quando terminar."
        }
        acoes={
          ctx.gestor ? (
            <>
              <RotinasIniciais
                empresaId={empresaId}
                existentes={modelos
                  .map((m) => m.chave_rotina)
                  .filter((c): c is string => Boolean(c))}
                loja={ctx.acesso.loja}
              />
              <Button asChild variante="contorno">
                <Link href={`${base}/modelos`}>
                  <Settings2 /> Modelos de tarefa
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      {tarefas.length ? (
        <QuadroTarefas
          empresaId={empresaId}
          tarefas={tarefas}
          funcionarios={funcionarios
            .filter((f) => f.ativo)
            .map((f) => ({ id: f.id, nome: f.nome }))}
          cargos={cargos.map((c) => ({ id: c.id, nome: c.nome }))}
          gestor={ctx.gestor}
        />
      ) : (
        <EstadoVazio
          icone={ListChecks}
          titulo={
            ctx.gestor
              ? "Nenhuma tarefa no quadro"
              : "Nenhuma tarefa atribuída a você"
          }
          descricao={
            ctx.gestor
              ? "Crie as tarefas recorrentes em Modelos de tarefa (ou use as rotinas iniciais). A tarefa de cada período aparece aqui."
              : "Quando o responsável atribuir uma tarefa a você, ela aparece aqui."
          }
        />
      )}
    </>
  );
}
