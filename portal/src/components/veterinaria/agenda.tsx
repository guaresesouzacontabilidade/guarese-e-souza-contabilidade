"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Check, Loader2, Pencil, Stethoscope, UserCheck, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { abrirAtendimento, mudarStatusAgenda, salvarAgendamento } from "@/lib/veterinaria/acoes";
import { TIPOS_AGENDA, TIPOS_ATENDIMENTO } from "@/lib/veterinaria/rotulos";
import { BuscaPaciente, type PacienteBusca } from "./comuns";

export interface AgendamentoForm {
  id: string;
  dia: string;
  hora: string;
  duracao_min: number;
  tipo: string;
  paciente: PacienteBusca | null;
  nome_avulso: string | null;
  telefone_avulso: string | null;
  veterinario_id: string | null;
  observacoes: string | null;
}

/** Novo agendamento (ou edição). Quem ainda não tem cadastro entra pelo nome e telefone. */
export function DialogoAgendamento({
  empresaId,
  veterinarios,
  agendamento,
  dia,
  paciente,
  duracaoPadrao,
  rotulo,
}: {
  empresaId: string;
  veterinarios: { id: string; nome: string }[];
  agendamento?: AgendamentoForm;
  dia?: string;
  paciente?: PacienteBusca | null;
  duracaoPadrao: number;
  rotulo?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [semCadastro, setSemCadastro] = React.useState(Boolean(agendamento && !agendamento.paciente));
  const a = agendamento;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {a ? (
          <Button variante="fantasma" tamanho="sm" aria-label="Alterar agendamento">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <CalendarPlus /> {rotulo ?? "Agendar"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={a ? "Alterar agendamento" : "Novo agendamento"} largura="lg">
        <FormularioAcao acao={salvarAgendamento.bind(null, empresaId, a?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              {semCadastro ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome de quem vai trazer" htmlFor="ag-nome" obrigatorio erro={estado.erros?.nome_avulso}>
                    <Input id="ag-nome" name="nome_avulso" maxLength={120} defaultValue={a?.nome_avulso ?? ""} placeholder="Tutor e animal (ex.: Maria — gata Mimi)" />
                  </Campo>
                  <Campo rotulo="Telefone" htmlFor="ag-telefone" erro={estado.erros?.telefone_avulso}>
                    <Input id="ag-telefone" name="telefone_avulso" inputMode="tel" maxLength={16} defaultValue={a?.telefone_avulso ?? ""} />
                  </Campo>
                </div>
              ) : (
                <BuscaPaciente empresaId={empresaId} inicial={a?.paciente ?? paciente ?? null} erro={estado.erros?.paciente_id} />
              )}
              <button type="button" className="text-sm text-primary underline" onClick={() => setSemCadastro((v) => !v)}>
                {semCadastro ? "Escolher um animal já cadastrado" : "Ainda não tem cadastro? Agende pelo nome e telefone"}
              </button>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Dia" htmlFor="ag-dia" obrigatorio erro={estado.erros?.dia}>
                  <Input id="ag-dia" name="dia" type="date" defaultValue={a?.dia ?? dia ?? ""} />
                </Campo>
                <Campo rotulo="Hora" htmlFor="ag-hora" obrigatorio erro={estado.erros?.hora}>
                  <Input id="ag-hora" name="hora" type="time" step={300} defaultValue={a?.hora ?? ""} />
                </Campo>
                <Campo rotulo="Duração (min)" htmlFor="ag-duracao">
                  <Input id="ag-duracao" name="duracao_min" type="number" min={5} max={720} step={5} defaultValue={a?.duracao_min ?? duracaoPadrao} />
                </Campo>
                <Campo rotulo="Tipo" htmlFor="ag-tipo">
                  <Select id="ag-tipo" name="tipo" defaultValue={a?.tipo ?? "consulta"}>
                    {Object.entries(TIPOS_AGENDA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Veterinário" htmlFor="ag-vet" className="sm:col-span-2">
                  <Select id="ag-vet" name="veterinario_id" defaultValue={a?.veterinario_id ?? ""}>
                    <option value="">Qualquer um</option>
                    {veterinarios.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <Campo rotulo="Observações" htmlFor="ag-obs">
                <Textarea id="ag-obs" name="observacoes" rows={2} maxLength={500} defaultValue={a?.observacoes ?? ""} placeholder="Ex.: vem em jejum para exame de sangue" />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{a ? "Salvar" : "Agendar"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Ações da recepção no agendamento (confirmou, chegou, faltou, cancelar) e o "Atender" do veterinário. */
export function AcoesAgendamento({
  empresaId,
  agendaId,
  status,
  podeAtender,
  temPaciente,
  atendimentoId,
}: {
  empresaId: string;
  agendaId: string;
  status: string;
  podeAtender: boolean;
  temPaciente: boolean;
  atendimentoId: string | null;
}) {
  const router = useRouter();
  if (atendimentoId) {
    return (
      <Button asChild variante="contorno" tamanho="sm">
        <a href={`/e/${empresaId}/veterinaria/atendimentos/${atendimentoId}`}>
          <Stethoscope /> Prontuário
        </a>
      </Button>
    );
  }
  if (!["agendado", "confirmado", "chegou"].includes(status)) return null;
  const s = (novo: string) => mudarStatusAgenda.bind(null, empresaId, agendaId, novo);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {status === "agendado" ? (
        <BotaoAcao variante="fantasma" tamanho="sm" acao={s("confirmado")}>
          <Check /> Confirmou
        </BotaoAcao>
      ) : null}
      {status !== "chegou" ? (
        <BotaoAcao variante="fantasma" tamanho="sm" acao={s("chegou")}>
          <UserCheck /> Chegou
        </BotaoAcao>
      ) : null}
      {podeAtender && temPaciente ? (
        <BotaoAcao
          tamanho="sm"
          acao={() => abrirAtendimento(empresaId, { agendamento_id: agendaId })}
          aoSucesso={(r) => {
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (id) router.push(`/e/${empresaId}/veterinaria/atendimentos/${id}`);
          }}
        >
          <Stethoscope /> Atender
        </BotaoAcao>
      ) : null}
      <BotaoAcao variante="fantasma" tamanho="sm" acao={s("faltou")} confirmar={{ titulo: "Marcar que faltou?", textoConfirmar: "Faltou" }}>
        <UserX /> Faltou
      </BotaoAcao>
      <BotaoAcao variante="fantasma" tamanho="sm" acao={s("cancelado")} confirmar={{ titulo: "Cancelar este agendamento?", textoConfirmar: "Cancelar agendamento", perigo: true }}>
        <X /> Cancelar
      </BotaoAcao>
    </div>
  );
}

/** Abre um atendimento sem agendamento (encaixe ou emergência) e vai para o prontuário. */
export function BotaoNovoAtendimento({ empresaId, pacienteId }: { empresaId: string; pacienteId: string }) {
  const router = useRouter();
  const [tipo, setTipo] = React.useState("consulta");
  const [pendente, iniciar] = React.useTransition();
  return (
    <div className="flex items-center gap-2">
      <Select aria-label="Tipo de atendimento" value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-9 w-auto">
        {Object.entries(TIPOS_ATENDIMENTO).map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </Select>
      <Button
        tamanho="sm"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await abrirAtendimento(empresaId, { paciente_id: pacienteId, tipo });
            if (!r.ok) {
              toast.error(r.mensagem ?? "Não foi possível abrir o atendimento.");
              return;
            }
            router.push(`/e/${empresaId}/veterinaria/atendimentos/${(r.dados as { id: string }).id}`);
          })
        }
      >
        {pendente ? <Loader2 className="animate-spin" /> : <Stethoscope />} Atender agora
      </Button>
    </div>
  );
}
