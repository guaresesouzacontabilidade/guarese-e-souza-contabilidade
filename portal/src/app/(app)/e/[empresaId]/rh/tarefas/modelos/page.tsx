import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Repeat } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DialogoModelo, RotinasIniciais } from "@/components/rh/modelos";
import { EtiquetaPeriodicidade } from "@/components/rh/etiqueta";
import {
  carregarCargos,
  carregarFuncionarios,
  carregarModelos,
  obterContextoRh,
} from "@/lib/rh/dados";
import { REGRA, descreverCalendario } from "@/lib/rh/rotulos";

export const metadata: Metadata = { title: "Modelos de tarefa" };

export default async function PaginaModelos({
  params,
}: PageProps<"/e/[empresaId]/rh/tarefas/modelos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoRh(empresaId);
  if (!ctx.gestor) notFound();
  const [modelos, cargos, funcionarios] = await Promise.all([
    carregarModelos(ctx.supabase, empresaId),
    carregarCargos(ctx.supabase, empresaId),
    carregarFuncionarios(ctx.supabase, empresaId),
  ]);
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const nomeFunc = new Map(funcionarios.map((f) => [f.id, f.nome]));
  const nomeModelo = new Map(modelos.map((m) => [m.id, m.titulo]));
  const ativos = funcionarios
    .filter((f) => f.ativo)
    .map((f) => ({ id: f.id, nome: f.nome }));
  const listaModelos = modelos.map((m) => ({ id: m.id, titulo: m.titulo }));
  const comum = {
    empresaId,
    cargos: cargos.map((c) => ({ id: c.id, nome: c.nome })),
    funcionarios: ativos,
    modelos: listaModelos,
    loja: ctx.acesso.loja,
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Modelos de tarefa"
        descricao="As rotinas da equipe. Cada dia, semana, quinzena ou mês vira uma tarefa no quadro; a do período concluída fica guardada e a próxima já aparece."
        voltar={{ href: `/e/${empresaId}/rh/tarefas`, rotulo: "Tarefas" }}
        acoes={
          <>
            <RotinasIniciais
              empresaId={empresaId}
              existentes={modelos
                .map((m) => m.chave_rotina)
                .filter((c): c is string => Boolean(c))}
              loja={ctx.acesso.loja}
            />
            <DialogoModelo {...comum} />
          </>
        }
      />
      {modelos.length ? (
        <Table>
          <THead>
            <Tr>
              <Th>Tarefa</Th>
              <Th className="hidden md:table-cell">Quando</Th>
              <Th className="hidden sm:table-cell">Cargo / responsável</Th>
              <Th className="hidden lg:table-cell">Como conclui</Th>
              <Th className="w-16">
                <span className="sr-only">Ações</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {modelos.map((m) => (
              <Tr key={m.id} className={m.ativo ? undefined : "opacity-60"}>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.titulo}</span>
                    <EtiquetaPeriodicidade periodicidade={m.periodicidade} />
                    {!m.ativo ? <Badge>Pausada</Badge> : null}
                  </div>
                  {m.depende_de_id ? (
                    <span className="block text-xs text-muted-foreground">
                      Depende de: {nomeModelo.get(m.depende_de_id)}
                    </span>
                  ) : null}
                </Td>
                <Td className="hidden md:table-cell text-sm">
                  {descreverCalendario(m)}
                </Td>
                <Td className="hidden sm:table-cell text-sm">
                  {m.cargo_id ? nomeCargo.get(m.cargo_id) : "Sem cargo"}
                  {m.responsavel_id ? (
                    <span className="block text-xs text-muted-foreground">
                      {nomeFunc.get(m.responsavel_id)}
                    </span>
                  ) : null}
                </Td>
                <Td className="hidden lg:table-cell text-sm">
                  {REGRA[m.regra].rotulo}
                  {m.regra === "manual" &&
                  (m.exige_foto || m.exige_area || m.exige_semana) ? (
                    <span className="block text-xs text-muted-foreground">
                      Exige{" "}
                      {[
                        m.exige_foto && "foto",
                        m.exige_area && "área",
                        m.exige_semana && "semana",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <DialogoModelo {...comum} modelo={m} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio
          icone={Repeat}
          titulo="Nenhuma tarefa recorrente"
          descricao="Crie as rotinas da equipe ou comece pelas rotinas iniciais (conferência do estoque, extrato, conciliação, pátio e caixa)."
        />
      )}
    </>
  );
}
