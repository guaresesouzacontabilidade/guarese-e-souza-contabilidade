"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, ClipboardPlus, FileText, MessageCircle, Pencil, UserCheck, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { abrirAvaliacao, abrirEvolucao, cancelarAgendamento, mudarStatusAgenda, salvarAgendamento } from "@/lib/fisioterapia/acoes";
import { DIAS_SEMANA, TIPOS_AGENDA } from "@/lib/fisioterapia/rotulos";
import { DialogoMotivo } from "./comuns";

export interface AgendamentoForm {
  id: string;
  dia: string;
  hora: string;
  duracao_min: number;
  tipo: string;
  paciente_id: string | null;
  nome_avulso: string | null;
  telefone_avulso: string | null;
  profissional_id: string | null;
  sala: string | null;
  observacoes: string | null;
}

type Opcao = { id: string; nome: string };

/** Novo agendamento (com repetição semanal) ou edição de um horário. */
export function DialogoAgendamento({
  empresaId,
  profissionais,
  pacientes,
  agendamento,
  dia,
  pacienteId,
  duracaoPadrao,
  rotulo,
}: {
  empresaId: string;
  profissionais: Opcao[];
  pacientes: Opcao[];
  agendamento?: AgendamentoForm;
  dia?: string;
  pacienteId?: string;
  duracaoPadrao: number;
  rotulo?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const a = agendamento;
  const [semCadastro, setSemCadastro] = React.useState(Boolean(a && !a.paciente_id));
  const [tipo, setTipo] = React.useState(a?.tipo ?? (pacienteId ? "sessao" : "avaliacao"));
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
      <DialogContent titulo={a ? "Alterar horário" : "Novo agendamento"} largura="lg">
        <FormularioAcao acao={salvarAgendamento.bind(null, empresaId, a?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              {semCadastro ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome de quem vem" htmlFor="ag-nome" obrigatorio erro={estado.erros?.nome_avulso}>
                    <Input id="ag-nome" name="nome_avulso" maxLength={120} defaultValue={a?.nome_avulso ?? ""} />
                  </Campo>
                  <Campo rotulo="Telefone" htmlFor="ag-telefone" erro={estado.erros?.telefone_avulso}>
                    <Input id="ag-telefone" name="telefone_avulso" inputMode="tel" maxLength={16} defaultValue={a?.telefone_avulso ?? ""} />
                  </Campo>
                </div>
              ) : (
                <Campo rotulo="Paciente" htmlFor="ag-paciente" obrigatorio erro={estado.erros?.paciente_id}>
                  <Select id="ag-paciente" name="paciente_id" defaultValue={a?.paciente_id ?? pacienteId ?? ""}>
                    <option value="">Escolha...</option>
                    {pacientes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              )}
              <button type="button" className="text-sm text-primary underline" onClick={() => setSemCadastro((v) => !v)}>
                {semCadastro ? "Escolher um paciente cadastrado" : "Primeira vez? Agende pelo nome e telefone"}
              </button>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Tipo" htmlFor="ag-tipo">
                  <Select id="ag-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    {Object.entries(TIPOS_AGENDA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Fisioterapeuta" htmlFor="ag-prof" obrigatorio erro={estado.erros?.profissional_id} className="sm:col-span-2">
                  <Select id="ag-prof" name="profissional_id" defaultValue={a?.profissional_id ?? (profissionais.length === 1 ? profissionais[0].id : "")}>
                    <option value="">Escolha...</option>
                    {profissionais.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo={a ? "Dia" : "Primeiro dia"} htmlFor="ag-dia" obrigatorio erro={estado.erros?.dia}>
                  <Input id="ag-dia" name="dia" type="date" defaultValue={a?.dia ?? dia ?? ""} />
                </Campo>
                <Campo rotulo="Hora" htmlFor="ag-hora" obrigatorio erro={estado.erros?.hora}>
                  <Input id="ag-hora" name="hora" type="time" step={300} defaultValue={a?.hora ?? ""} />
                </Campo>
                <Campo rotulo="Duração (min)" htmlFor="ag-duracao">
                  <Input id="ag-duracao" name="duracao_min" type="number" min={10} max={480} step={5} defaultValue={a?.duracao_min ?? duracaoPadrao} />
                </Campo>
                <Campo rotulo="Sala ou box" htmlFor="ag-sala">
                  <Input id="ag-sala" name="sala" maxLength={40} defaultValue={a?.sala ?? ""} placeholder="Ex.: Box 2" />
                </Campo>
              </div>
              {!a ? (
                <fieldset className="space-y-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-medium">Repetir (opcional)</legend>
                  <p className="text-xs text-muted-foreground">Marque os dias e por quantas semanas. As sessões entram no pacote ativo do paciente.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    {DIAS_SEMANA.map((d) => (
                      <label key={d.v} className="flex items-center gap-1.5 text-sm">
                        <Checkbox name="dias_semana" value={d.v} /> {d.curto}
                      </label>
                    ))}
                    <label className="flex items-center gap-2 text-sm">
                      por
                      <Input name="semanas" type="number" min={1} max={12} defaultValue={1} className="h-9 w-20" aria-label="Semanas" />
                      semana(s)
                    </label>
                  </div>
                  {estado.erros?.semanas ? <p className="text-xs text-perigo">{estado.erros.semanas[0]}</p> : null}
                </fieldset>
              ) : null}
              <Campo rotulo="Observações" htmlFor="ag-obs">
                <Textarea id="ag-obs" name="observacoes" rows={2} maxLength={500} defaultValue={a?.observacoes ?? ""} placeholder="Ex.: trazer o pedido médico e os exames" />
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

/** Ações do horário: confirmar (WhatsApp da clínica), chegou, atender (fisioterapeuta), faltou e cancelar. */
export function AcoesAgendamento({
  empresaId,
  agendaId,
  status,
  tipo,
  podeAtender,
  temPaciente,
  temSerie,
  whatsapp,
  registro,
}: {
  empresaId: string;
  agendaId: string;
  status: string;
  tipo: string;
  podeAtender: boolean;
  temPaciente: boolean;
  temSerie: boolean;
  /** Link do WhatsApp com a mensagem de confirmação (null sem telefone ou sem autorização). */
  whatsapp: string | null;
  /** Avaliação ou evolução já aberta para este horário. */
  registro: { tipo: "avaliacao" | "evolucao"; id: string } | null;
}) {
  const router = useRouter();
  const base = `/e/${empresaId}/fisioterapia`;
  if (registro && podeAtender) {
    return (
      <Button asChild variante="contorno" tamanho="sm">
        <a href={`${base}/${registro.tipo === "avaliacao" ? "avaliacoes" : "evolucoes"}/${registro.id}`}>
          <FileText /> Prontuário
        </a>
      </Button>
    );
  }
  if (!["agendado", "confirmado", "chegou"].includes(status)) return null;
  const s = (novo: string) => mudarStatusAgenda.bind(null, empresaId, agendaId, novo);
  const avaliacao = tipo === "avaliacao" || tipo === "reavaliacao";
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {status === "agendado" && whatsapp ? (
        <Button asChild variante="fantasma" tamanho="sm">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> WhatsApp
          </a>
        </Button>
      ) : null}
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
          acao={() => (avaliacao ? abrirAvaliacao(empresaId, { agendamento_id: agendaId }) : abrirEvolucao(empresaId, { agendamento_id: agendaId }))}
          aoSucesso={(r) => {
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (id) router.push(`${base}/${avaliacao ? "avaliacoes" : "evolucoes"}/${id}`);
          }}
        >
          <ClipboardPlus /> {avaliacao ? "Avaliar" : "Evoluir"}
        </BotaoAcao>
      ) : null}
      <BotaoAcao variante="fantasma" tamanho="sm" acao={s("faltou")} confirmar={{ titulo: "Marcar que o paciente faltou?", textoConfirmar: "Faltou" }}>
        <UserX /> Faltou
      </BotaoAcao>
      <DialogoMotivo
        acao={cancelarAgendamento.bind(null, empresaId, agendaId)}
        titulo="Cancelar este horário?"
        rotuloBotao="Cancelar"
        textoConfirmar="Cancelar horário"
        icone={<X />}
        caixa={temSerie ? { nome: "toda_serie", rotulo: "Cancelar também os próximos horários desta repetição" } : undefined}
      />
    </div>
  );
}
