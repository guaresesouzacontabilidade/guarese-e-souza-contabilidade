import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { DialogoAgendamento } from "@/components/fisioterapia/agenda";
import { ListaAgenda } from "@/components/fisioterapia/lista-agenda";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { hojeClinica, somarDias } from "@/lib/veterinaria/contexto";
import { diaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData } from "@/lib/formatos";
import { carregarAgenda, opcoesClinica } from "../dados";

export const metadata: Metadata = { title: "Agenda da clínica" };

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaAgendaFisio({ params, searchParams }: PageProps<"/e/[empresaId]/fisioterapia/agenda">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const dia = typeof sp.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoje;
  const prof = typeof sp.profissional === "string" && UUID.test(sp.profissional) ? sp.profissional : null;
  const base = `/e/${empresaId}/fisioterapia`;
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(dia, i - 3));
  const [agendaSemana, opcoes] = await Promise.all([carregarAgenda(ctx, empresaId, semana[0], semana[6], prof), opcoesClinica(ctx, empresaId)]);
  const doDia = agendaSemana.linhas.filter((l) => diaLocal(l.inicio) === dia);
  const porDia = new Map<string, number>();
  for (const l of agendaSemana.linhas) if (!["cancelado", "faltou"].includes(l.status)) porDia.set(diaLocal(l.inicio), (porDia.get(diaLocal(l.inicio)) ?? 0) + 1);
  const link = (d: string, p: string | null = prof) => `${base}/agenda?dia=${d}${p ? `&profissional=${p}` : ""}`;

  return (
    <>
      <CabecalhoPagina
        titulo="Agenda"
        descricao="Avaliações, sessões, reavaliações e grupos, por fisioterapeuta. Sessões repetidas entram no pacote do paciente."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
        acoes={<DialogoAgendamento empresaId={empresaId} profissionais={opcoes.profissionais} pacientes={opcoes.pacientes} dia={dia} duracaoPadrao={agendaSemana.duracaoPadrao} />}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href={link(dia, null)} className={`rounded-full border px-3 py-1 text-sm ${!prof ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
          Todos
        </Link>
        {opcoes.profissionais.map((p) => (
          <Link
            key={p.id}
            href={link(dia, p.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${prof === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
          >
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: p.cor }} aria-hidden /> {p.nome}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Semana anterior">
          <Link href={link(somarDias(dia, -7))}>
            <ChevronLeft />
          </Link>
        </Button>
        {semana.map((d) => {
          const [a, m, dd] = d.split("-").map(Number);
          const sem = SEMANA[new Date(Date.UTC(a, m - 1, dd)).getUTCDay()];
          return (
            <Link
              key={d}
              href={link(d)}
              className={`min-w-16 rounded-xl border px-3 py-2 text-center text-sm ${d === dia ? "border-primary bg-primary text-primary-foreground" : d === hoje ? "border-primary/50" : "border-border hover:bg-muted"}`}
            >
              <span className="block text-xs uppercase">{sem}</span>
              <span className="block font-semibold">{`${String(dd).padStart(2, "0")}/${String(m).padStart(2, "0")}`}</span>
              <span className="block text-xs opacity-80">{porDia.get(d) ?? 0}</span>
            </Link>
          );
        })}
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Próxima semana">
          <Link href={link(somarDias(dia, 7))}>
            <ChevronRight />
          </Link>
        </Button>
        {dia !== hoje ? (
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={link(hoje)}>Hoje</Link>
          </Button>
        ) : null}
      </div>
      <h2 className="mb-2 font-semibold">{formatarData(dia)}</h2>
      {doDia.length ? (
        <Card>
          <CardContent className="py-1">
            <ListaAgenda
              empresaId={empresaId}
              linhas={doDia}
              podeAtender={Boolean(ctx.profissional)}
              profissionais={opcoes.profissionais}
              pacientes={opcoes.pacientes}
              duracaoPadrao={agendaSemana.duracaoPadrao}
            />
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={CalendarDays} titulo="Nenhum horário neste dia" />
      )}
    </>
  );
}
