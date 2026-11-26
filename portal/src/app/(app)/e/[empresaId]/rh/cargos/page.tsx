import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { DialogoCargo, ExcluirCargo } from "@/components/rh/cargos";
import { EtiquetaPeriodicidade } from "@/components/rh/etiqueta";
import {
  carregarCargos,
  carregarFuncionarios,
  carregarModelos,
  obterContextoRh,
} from "@/lib/rh/dados";

export const metadata: Metadata = { title: "Cargos" };

export default async function PaginaCargos({
  params,
}: PageProps<"/e/[empresaId]/rh/cargos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoRh(empresaId);
  if (!ctx.gestor) notFound();
  const [cargos, funcionarios, modelos] = await Promise.all([
    carregarCargos(ctx.supabase, empresaId),
    carregarFuncionarios(ctx.supabase, empresaId),
    carregarModelos(ctx.supabase, empresaId),
  ]);
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const modelosTela = modelos.map((m) => ({
    id: m.id,
    titulo: m.titulo,
    periodicidade: m.periodicidade,
    cargo_id: m.cargo_id,
    cargo: m.cargo_id ? (nomeCargo.get(m.cargo_id) ?? null) : null,
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Cargos"
        descricao="O que cada cargo faz e as tarefas recorrentes de responsabilidade dele."
        acoes={<DialogoCargo empresaId={empresaId} modelos={modelosTela} />}
      />
      {cargos.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {cargos.map((c) => {
            const pessoas = funcionarios.filter(
              (f) => f.cargo_id === c.id && f.ativo,
            );
            const tarefas = modelos.filter((m) => m.cargo_id === c.id);
            return (
              <Card key={c.id} data-testid="cartao-cargo">
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{c.nome}</h3>
                      {c.descricao ? (
                        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                          {c.descricao}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <DialogoCargo
                        empresaId={empresaId}
                        cargo={c}
                        modelos={modelosTela}
                      />
                      <ExcluirCargo empresaId={empresaId} cargo={c} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Quem é do cargo
                    </p>
                    <p className="text-sm">
                      {pessoas.length
                        ? pessoas.map((p) => p.nome).join(", ")
                        : "Ninguém ainda (escolha o cargo no cadastro do funcionário)."}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tarefas de responsabilidade
                    </p>
                    {tarefas.length ? (
                      <ul className="mt-1 space-y-1">
                        {tarefas.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <EtiquetaPeriodicidade
                              periodicidade={m.periodicidade}
                            />{" "}
                            {m.titulo}
                            {!m.ativo ? (
                              <span className="text-xs text-muted-foreground">
                                (pausada)
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma tarefa ligada.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EstadoVazio
          icone={BriefcaseBusiness}
          titulo="Nenhum cargo cadastrado"
          descricao="Cadastre os cargos com a descrição e ligue a cada um as tarefas de responsabilidade dele."
        />
      )}
    </>
  );
}
