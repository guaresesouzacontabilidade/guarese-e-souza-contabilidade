"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Textarea } from "@/components/ui/form";
import { excluirCargo, salvarCargo } from "@/lib/rh/acoes";
import { PERIODICIDADE, type Periodicidade } from "@/lib/rh/rotulos";

export interface CargoTela {
  id: string;
  nome: string;
  descricao: string | null;
}

/** Cadastrar ou alterar um cargo: descrição e os modelos de tarefa de responsabilidade dele. */
export function DialogoCargo({
  empresaId,
  cargo,
  modelos,
}: {
  empresaId: string;
  cargo?: CargoTela;
  modelos: {
    id: string;
    titulo: string;
    periodicidade: Periodicidade;
    cargo_id: string | null;
    cargo: string | null;
  }[];
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {cargo ? (
          <Button
            variante="fantasma"
            tamanho="iconeSm"
            aria-label={`Editar ${cargo.nome}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Novo cargo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={cargo ? `Editar ${cargo.nome}` : "Novo cargo"}
        descricao="O que o cargo faz e as tarefas recorrentes de responsabilidade dele."
        largura="lg"
      >
        <FormularioAcao
          acao={salvarCargo.bind(null, empresaId, cargo?.id ?? null)}
          aoSucesso={() => setAberto(false)}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <Campo
                rotulo="Nome do cargo"
                htmlFor="nome-cargo"
                obrigatorio
                erro={estado.erros?.nome}
              >
                <Input
                  id="nome-cargo"
                  name="nome"
                  defaultValue={cargo?.nome}
                  maxLength={80}
                  required
                  placeholder="Ex.: Auxiliar de pátio"
                />
              </Campo>
              <Campo
                rotulo="Descrição do cargo"
                htmlFor="descricao-cargo"
                ajuda="O que a pessoa faz no dia a dia."
              >
                <Textarea
                  id="descricao-cargo"
                  name="descricao"
                  defaultValue={cargo?.descricao ?? ""}
                  maxLength={2000}
                  rows={3}
                />
              </Campo>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Tarefas de responsabilidade do cargo
                </legend>
                {modelos.length ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {modelos.map((m) => (
                      <label
                        key={m.id}
                        className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
                      >
                        <Checkbox
                          name="modelos"
                          value={m.id}
                          defaultChecked={Boolean(
                            cargo && m.cargo_id === cargo.id,
                          )}
                          className="mt-0.5"
                        />
                        <span>
                          {m.titulo}
                          <span className="block text-xs text-muted-foreground">
                            {PERIODICIDADE[m.periodicidade].rotulo}
                            {m.cargo && (!cargo || m.cargo_id !== cargo.id)
                              ? ` · hoje com o cargo ${m.cargo}`
                              : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma tarefa cadastrada ainda. Crie em Tarefas → Modelos
                    de tarefa.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Cada tarefa fica com um cargo só. As tarefas novas vão para
                  quem é do cargo (se houver uma pessoa só) ou você atribui no
                  quadro.
                </p>
              </fieldset>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>
                  {cargo ? "Salvar cargo" : "Cadastrar cargo"}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirCargo({
  empresaId,
  cargo,
}: {
  empresaId: string;
  cargo: CargoTela;
}) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="iconeSm"
      aria-label={`Excluir ${cargo.nome}`}
      acao={() => excluirCargo(empresaId, cargo.id)}
      confirmar={{
        titulo: `Excluir o cargo "${cargo.nome}"?`,
        descricao:
          "Os funcionários continuam com o nome do cargo escrito no cadastro, e as tarefas do cargo ficam sem cargo.",
        textoConfirmar: "Excluir cargo",
        perigo: true,
      }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}
