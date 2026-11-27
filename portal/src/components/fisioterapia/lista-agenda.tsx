import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { horaLocal, diaLocal } from "@/lib/veterinaria/rotulos";
import { formatarTelefone } from "@/lib/formatos";
import { CONFIRMACAO_ENVIO, STATUS_AGENDA, TIPOS_AGENDA } from "@/lib/fisioterapia/rotulos";
import { AcoesAgendamento, DialogoAgendamento } from "./agenda";

type Linha = {
  id: string;
  inicio: string;
  duracao_min: number;
  tipo: string;
  status: string;
  sala: string | null;
  observacoes: string | null;
  nome_avulso: string | null;
  telefone_avulso: string | null;
  serie_id: string | null;
  profissional_id: string | null;
  motivo: string | null;
  confirmacao_envio?: string | null;
  confirmacao_destino?: string | null;
  confirmacao_resposta?: string | null;
  confirmacao_erro?: string | null;
  paciente: { id: string; nome: string; telefone: string | null; convenio: string | null } | null;
  profissional: { nome: string; cor: string } | null;
  whatsapp: string | null;
  registro: { tipo: "avaliacao" | "evolucao"; id: string } | null;
};

/** Lista de horários (painel e agenda): hora, paciente, fisioterapeuta, situação e ações. */
export function ListaAgenda({
  empresaId,
  linhas,
  podeAtender,
  profissionais,
  pacientes,
  duracaoPadrao,
  confirmacao = { ativa: false, teste: false },
}: {
  empresaId: string;
  linhas: Linha[];
  podeAtender: boolean;
  profissionais: { id: string; nome: string }[];
  pacientes: { id: string; nome: string }[];
  duracaoPadrao: number;
  /** Confirmação automática pelo WhatsApp da clínica (e se está no modo teste) */
  confirmacao?: { ativa: boolean; teste: boolean };
}) {
  const base = `/e/${empresaId}/fisioterapia`;
  return (
    <ul className="divide-y divide-border">
      {linhas.map((a) => {
        const st = STATUS_AGENDA[a.status];
        const encerrado = ["cancelado", "faltou"].includes(a.status);
        const editavel = ["agendado", "confirmado", "chegou"].includes(a.status);
        return (
          <li key={a.id} className={`flex flex-col gap-2 py-3 ${encerrado ? "opacity-60" : ""}`}>
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="w-14 shrink-0">
                <p className="numero font-semibold">{horaLocal(a.inicio)}</p>
                <p className="text-xs text-muted-foreground">{a.duracao_min} min</p>
              </div>
              <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: a.profissional?.cor ?? "var(--border)" }} aria-hidden />
              <div className="min-w-0">
                {a.paciente ? (
                  <Link href={`${base}/pacientes/${a.paciente.id}`} className="font-medium text-primary hover:underline">
                    {a.paciente.nome}
                  </Link>
                ) : (
                  <span className="font-medium">{a.nome_avulso}</span>
                )}
                <p className="text-xs text-muted-foreground">
                  {TIPOS_AGENDA[a.tipo] ?? a.tipo} · {a.profissional?.nome ?? "—"}
                  {a.sala ? ` · ${a.sala}` : ""}
                  {a.paciente?.convenio ? ` · ${a.paciente.convenio}` : ""}
                  {!a.paciente ? ` · sem cadastro${a.telefone_avulso ? ` · ${formatarTelefone(a.telefone_avulso)}` : ""}` : ""}
                </p>
                {a.observacoes ? <p className="text-xs text-muted-foreground">Obs.: {a.observacoes}</p> : null}
                {encerrado && a.motivo ? <p className="text-xs text-muted-foreground">Motivo: {a.motivo}</p> : null}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
                  {a.confirmacao_resposta === "confirmou" ? (
                    <Badge variante="sucesso" data-testid="confirmou-whatsapp">
                      Confirmou pelo link
                    </Badge>
                  ) : a.confirmacao_resposta === "desmarcou" ? (
                    <Badge variante="perigo">Desmarcou pelo link</Badge>
                  ) : a.confirmacao_envio && a.confirmacao_envio !== "dispensado" ? (
                    <span
                      className={`text-[11px] ${CONFIRMACAO_ENVIO[a.confirmacao_envio]?.tom === "perigo" ? "text-perigo" : CONFIRMACAO_ENVIO[a.confirmacao_envio]?.tom === "alerta" ? "text-alerta" : "text-muted-foreground"}`}
                      title={a.confirmacao_erro ?? undefined}
                      data-testid="situacao-confirmacao"
                    >
                      {CONFIRMACAO_ENVIO[a.confirmacao_envio]?.rotulo ?? a.confirmacao_envio}
                      {a.confirmacao_destino === "teste" ? " (número de teste)" : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-1 sm:pl-[4.5rem] [&>div]:justify-start">
              {editavel ? (
                <DialogoAgendamento
                  empresaId={empresaId}
                  profissionais={profissionais}
                  pacientes={pacientes}
                  duracaoPadrao={duracaoPadrao}
                  agendamento={{
                    id: a.id,
                    dia: diaLocal(a.inicio),
                    hora: horaLocal(a.inicio),
                    duracao_min: a.duracao_min,
                    tipo: a.tipo,
                    paciente_id: a.paciente?.id ?? null,
                    nome_avulso: a.nome_avulso,
                    telefone_avulso: a.telefone_avulso,
                    profissional_id: a.profissional_id,
                    sala: a.sala,
                    observacoes: a.observacoes,
                  }}
                />
              ) : null}
              <AcoesAgendamento
                empresaId={empresaId}
                agendaId={a.id}
                status={a.status}
                tipo={a.tipo}
                podeAtender={podeAtender}
                temPaciente={Boolean(a.paciente)}
                temSerie={Boolean(a.serie_id)}
                whatsapp={a.whatsapp}
                registro={a.registro}
                enviarConfirmacao={confirmacao.ativa && a.status === "agendado" && a.confirmacao_envio !== "pendente" && !a.confirmacao_resposta}
                confirmacaoTeste={confirmacao.teste}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
