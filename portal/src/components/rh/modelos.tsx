"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPlus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { criarRotinasIniciais, salvarModelo } from "@/lib/rh/acoes";
import {
  DIAS_SEMANA,
  PERIODICIDADE,
  PERIODICIDADES,
  REGRA,
  type Periodicidade,
  type RegraTarefa,
} from "@/lib/rh/rotulos";
import type { ModeloRh } from "@/lib/rh/dados";

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 7];

/** Criar ou alterar um modelo de tarefa recorrente (a rotina; cada período vira uma tarefa no quadro). */
export function DialogoModelo({
  empresaId,
  modelo,
  cargos,
  funcionarios,
  modelos,
  loja,
}: {
  empresaId: string;
  modelo?: ModeloRh;
  cargos: { id: string; nome: string }[];
  funcionarios: { id: string; nome: string }[];
  modelos: { id: string; titulo: string }[];
  /** Gestão da loja ligada (fechamento do caixa e conferência do estoque) */
  loja: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [periodicidade, setPeriodicidade] = React.useState<Periodicidade>(
    modelo?.periodicidade ?? "semanal",
  );
  const [regra, setRegra] = React.useState<RegraTarefa>(
    modelo?.regra ?? "manual",
  );
  const regras = (Object.keys(REGRA) as RegraTarefa[]).filter(
    (r) =>
      loja ||
      (r !== "fechamento_caixa" && r !== "conferencia_estoque") ||
      r === regra,
  );
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {modelo ? (
          <Button
            variante="fantasma"
            tamanho="iconeSm"
            aria-label={`Editar ${modelo.titulo}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Nova tarefa recorrente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={modelo ? `Editar ${modelo.titulo}` : "Nova tarefa recorrente"}
        descricao="A rotina: cada dia, semana, quinzena ou mês vira uma tarefa no quadro."
        largura="lg"
      >
        <FormularioAcao
          acao={salvarModelo.bind(null, empresaId, modelo?.id ?? null)}
          aoSucesso={() => setAberto(false)}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <Campo
                rotulo="Título"
                htmlFor="titulo-modelo"
                obrigatorio
                erro={estado.erros?.titulo}
              >
                <Input
                  id="titulo-modelo"
                  name="titulo"
                  defaultValue={modelo?.titulo}
                  maxLength={120}
                  required
                  placeholder="Ex.: Organização do pátio"
                />
              </Campo>
              <Campo rotulo="Como fazer (opcional)" htmlFor="descricao-modelo">
                <Textarea
                  id="descricao-modelo"
                  name="descricao"
                  defaultValue={modelo?.descricao ?? ""}
                  maxLength={2000}
                  rows={2}
                />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo
                  rotulo="Periodicidade"
                  htmlFor="periodicidade"
                  obrigatorio
                  erro={estado.erros?.periodicidade}
                >
                  <Select
                    id="periodicidade"
                    name="periodicidade"
                    value={periodicidade}
                    onChange={(e) =>
                      setPeriodicidade(e.target.value as Periodicidade)
                    }
                  >
                    {PERIODICIDADES.map((p) => (
                      <option key={p} value={p}>
                        {PERIODICIDADE[p].rotulo}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {periodicidade === "semanal" ? (
                  <Campo rotulo="Dia do prazo" htmlFor="dia_semana">
                    <Select
                      id="dia_semana"
                      name="dia_semana"
                      defaultValue={String(modelo?.dia_semana ?? 5)}
                    >
                      {ORDEM_DIAS.map((d) => (
                        <option key={d} value={d}>
                          {DIAS_SEMANA[d].longo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : periodicidade === "mensal" ? (
                  <Campo
                    rotulo="Dia do prazo"
                    htmlFor="dia_mes"
                    ajuda="31 = último dia do mês."
                  >
                    <Input
                      id="dia_mes"
                      name="dia_mes"
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={modelo?.dia_mes ?? 5}
                    />
                  </Campo>
                ) : periodicidade === "quinzenal" ? (
                  <p className="self-end pb-2 text-xs text-muted-foreground">
                    Prazo: último dia de cada quinzena (dia 15 e fim do mês).
                  </p>
                ) : (
                  <span />
                )}
                <Campo
                  rotulo="Hora do prazo"
                  htmlFor="hora_limite"
                  erro={estado.erros?.hora_limite}
                >
                  <Input
                    id="hora_limite"
                    name="hora_limite"
                    type="time"
                    defaultValue={(modelo?.hora_limite ?? "18:00").slice(0, 5)}
                  />
                </Campo>
              </div>
              {periodicidade === "diaria" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    Dias em que acontece
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {ORDEM_DIAS.map((d) => (
                      <label
                        key={d}
                        className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
                      >
                        <Checkbox
                          name="dias_semana"
                          value={d}
                          defaultChecked={(
                            modelo?.dias_semana ?? [1, 2, 3, 4, 5, 6]
                          ).includes(d)}
                        />
                        {DIAS_SEMANA[d].curto}
                      </label>
                    ))}
                  </div>
                  {estado.erros?.dias_semana ? (
                    <p className="text-xs text-perigo">
                      {estado.erros.dias_semana[0]}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Cargo responsável" htmlFor="cargo_id">
                  <Select
                    id="cargo_id"
                    name="cargo_id"
                    defaultValue={modelo?.cargo_id ?? ""}
                  >
                    <option value="">Sem cargo</option>
                    {cargos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo
                  rotulo="Responsável padrão (opcional)"
                  htmlFor="responsavel_id"
                  ajuda="Sem ele, vai para a pessoa do cargo (se houver uma só)."
                >
                  <Select
                    id="responsavel_id"
                    name="responsavel_id"
                    defaultValue={modelo?.responsavel_id ?? ""}
                  >
                    <option value="">Pela pessoa do cargo</option>
                    {funcionarios.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <Campo
                rotulo="Como conclui"
                htmlFor="regra"
                ajuda={REGRA[regra].ajuda}
              >
                <Select
                  id="regra"
                  name="regra"
                  value={regra}
                  onChange={(e) => setRegra(e.target.value as RegraTarefa)}
                >
                  {regras.map((r) => (
                    <option key={r} value={r}>
                      {REGRA[r].rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              {regra === "fechamento_caixa" ? (
                <Campo
                  rotulo="Nome do caixa (opcional)"
                  htmlFor="caixa_nome"
                  ajuda="Vazio: conclui quando todos os caixas do dia estão fechados."
                >
                  <Input
                    id="caixa_nome"
                    name="caixa_nome"
                    defaultValue={modelo?.parametros?.caixa_nome ?? ""}
                    maxLength={40}
                    placeholder="Ex.: Caixa 1"
                  />
                </Campo>
              ) : null}
              {regra === "manual" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    Para concluir, exigir
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary">
                      <Checkbox
                        name="exige_foto"
                        defaultChecked={modelo?.exige_foto}
                      />{" "}
                      Foto
                    </label>
                    <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary">
                      <Checkbox
                        name="exige_area"
                        defaultChecked={modelo?.exige_area}
                      />{" "}
                      Área
                    </label>
                    <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary">
                      <Checkbox
                        name="exige_semana"
                        defaultChecked={modelo?.exige_semana}
                      />{" "}
                      Semana de referência
                    </label>
                  </div>
                </fieldset>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  rotulo="Depende de (opcional)"
                  htmlFor="depende_de_id"
                  ajuda="Só conclui depois da tarefa do mesmo período desta outra."
                >
                  <Select
                    id="depende_de_id"
                    name="depende_de_id"
                    defaultValue={modelo?.depende_de_id ?? ""}
                  >
                    <option value="">Não depende de outra</option>
                    {modelos
                      .filter((m) => m.id !== modelo?.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.titulo}
                        </option>
                      ))}
                  </Select>
                </Campo>
                <Campo rotulo="Situação" htmlFor="ativo-modelo">
                  <Select
                    id="ativo-modelo"
                    name="ativo"
                    defaultValue={modelo && !modelo.ativo ? "off" : "on"}
                  >
                    <option value="on">Ativa (gera as tarefas)</option>
                    <option value="off">Pausada (não gera novas)</option>
                  </Select>
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>
                  {modelo ? "Salvar" : "Criar tarefa recorrente"}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

const ROTINAS = [
  {
    chave: "conferencia_estoque",
    titulo: "Conferência de estoque",
    detalhe: "Semanal · botão Confirmar conferência (registra quem e quando)",
    loja: true,
  },
  {
    chave: "envio_extrato",
    titulo: "Envio do extrato bancário à contabilidade",
    detalhe: "Semanal · quem enviou confirma a semana de referência",
    loja: false,
  },
  {
    chave: "conciliacao_semanal",
    titulo: "Conciliação bancária semanal",
    detalhe:
      "Semanal · conclui sozinha com todos os movimentos conciliados; depende do envio do extrato",
    loja: false,
  },
  {
    chave: "organizacao_patio",
    titulo: "Organização do pátio",
    detalhe: "Semanal · manual, com foto, área e semana",
    loja: false,
  },
  {
    chave: "fechamento_caixa",
    titulo: "Fechamento do caixa",
    detalhe:
      "Diária (seg a sáb) · conclui sozinha quando o caixa do dia é fechado",
    loja: true,
  },
];

/** Rotinas prontas (a empresa escolhe quais quer; não cria duas vezes). */
export function RotinasIniciais({
  empresaId,
  existentes,
  loja,
}: {
  empresaId: string;
  existentes: string[];
  loja: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const disponiveis = ROTINAS.filter(
    (r) => !existentes.includes(r.chave) && (loja || !r.loja),
  );
  const [marcadas, setMarcadas] = React.useState<string[]>(() =>
    disponiveis.map((r) => r.chave),
  );
  const [pendente, iniciar] = React.useTransition();
  if (!disponiveis.length) return null;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno">
          <ListPlus /> Criar rotinas iniciais
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo="Rotinas iniciais"
        descricao="Tarefas prontas para começar. Depois, ajuste o cargo, o responsável e o horário de cada uma."
      >
        <div className="space-y-2">
          {disponiveis.map((r) => (
            <label
              key={r.chave}
              className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
            >
              <Checkbox
                checked={marcadas.includes(r.chave)}
                onChange={(e) =>
                  setMarcadas((m) =>
                    e.target.checked
                      ? [...m, r.chave]
                      : m.filter((x) => x !== r.chave),
                  )
                }
                className="mt-0.5"
              />
              <span>
                {r.titulo}
                <span className="block text-xs text-muted-foreground">
                  {r.detalhe}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={!marcadas.length || pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await criarRotinasIniciais(empresaId, marcadas);
                if (r.ok) {
                  toast.success(r.mensagem ?? "Rotinas criadas.");
                  setAberto(false);
                  router.refresh();
                } else toast.error(r.mensagem ?? "Não foi possível criar.");
              })
            }
          >
            Criar {marcadas.length} rotina(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
