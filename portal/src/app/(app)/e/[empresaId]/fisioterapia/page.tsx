import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CalendarCheck, CalendarDays, PackageOpen, UserX, Users } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { AvisoSemProfissional, FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { DialogoAgendamento } from "@/components/fisioterapia/agenda";
import { DialogoPaciente } from "@/components/fisioterapia/cadastros";
import { ListaAgenda } from "@/components/fisioterapia/lista-agenda";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { hojeClinica } from "@/lib/veterinaria/contexto";
import { formatarData } from "@/lib/formatos";
import { carregarAgenda, opcoesClinica } from "./dados";

export const metadata: Metadata = { title: "Clínica de fisioterapia" };

export default async function PaginaPainelFisio({ params }: PageProps<"/e/[empresaId]/fisioterapia">) {
  const { empresaId } = await params;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const mes = hoje.slice(0, 7);
  const base = `/e/${empresaId}/fisioterapia`;
  const [agenda, opcoes, { count: ativos }, { data: mesAg }, { data: pacotes }] = await Promise.all([
    carregarAgenda(ctx, empresaId, hoje, hoje, ctx.profissional && !ctx.gerente ? ctx.profissional.id : null),
    opcoesClinica(ctx, empresaId),
    ctx.supabase.from("fisio_pacientes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true),
    ctx.supabase.from("fisio_agenda").select("status").eq("empresa_id", empresaId).gte("inicio", `${mes}-01T00:00:00-03:00`).lte("inicio", `${hoje}T23:59:59-03:00`),
    ctx.supabase.rpc("fisio_pacotes_resumo", { p_empresa_id: empresaId }),
  ]);
  const realizados = (mesAg ?? []).filter((a) => a.status === "realizado").length;
  const faltas = (mesAg ?? []).filter((a) => a.status === "faltou").length;
  const taxaFalta = realizados + faltas > 0 ? Math.round((faltas * 100) / (realizados + faltas)) : 0;
  const acabando = (pacotes ?? []).filter((k) => k.status === "ativo" && k.sessoes - k.usadas <= 2);
  const semConfirmar = agenda.linhas.filter((l) => l.status === "agendado").length;

  return (
    <>
      <CabecalhoPagina
        titulo="Painel da clínica"
        descricao={`Hoje, ${formatarData(hoje)}${ctx.profissional ? ` · ${ctx.profissional.nome}` : ""}`}
        acoes={
          <div className="flex flex-wrap gap-2">
            <DialogoPaciente empresaId={empresaId} />
            <DialogoAgendamento empresaId={empresaId} profissionais={opcoes.profissionais} pacientes={opcoes.pacientes} dia={hoje} duracaoPadrao={agenda.duracaoPadrao} />
          </div>
        }
      />
      {!ctx.profissional ? <AvisoSemProfissional gerente={ctx.gerente} empresaId={empresaId} /> : null}
      <div className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Horários hoje" valor={agenda.linhas.filter((l) => l.status !== "cancelado").length} detalhe={`${semConfirmar} sem confirmar`} icone={CalendarDays} href={`${base}/agenda`} />
        <Indicador rotulo="Sessões no mês" valor={realizados} detalhe="realizadas até hoje" tom="sucesso" icone={CalendarCheck} />
        <Indicador rotulo="Faltas no mês" valor={`${taxaFalta}%`} detalhe={`${faltas} falta(s)`} tom={taxaFalta >= 15 ? "perigo" : "neutro"} icone={UserX} />
        <Indicador rotulo="Pacientes ativos" valor={ativos ?? 0} icone={Users} href={`${base}/pacientes`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Agenda de hoje</CardTitle>
            <CardDescription>Confirme pelo WhatsApp da clínica, marque quem chegou e quem faltou. O fisioterapeuta abre a avaliação ou a evolução daqui.</CardDescription>
          </CardHeader>
          <CardContent>
            {agenda.linhas.length ? (
              <ListaAgenda
                empresaId={empresaId}
                linhas={agenda.linhas}
                podeAtender={Boolean(ctx.profissional)}
                profissionais={opcoes.profissionais}
                pacientes={opcoes.pacientes}
                duracaoPadrao={agenda.duracaoPadrao}
                confirmacao={agenda.confirmacao}
              />
            ) : (
              <EstadoVazio icone={Activity} titulo="Nenhum horário hoje" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pacotes acabando</CardTitle>
            <CardDescription>Faltam 2 sessões ou menos: hora de renovar ou reavaliar.</CardDescription>
          </CardHeader>
          <CardContent>
            {acabando.length ? (
              <ul className="space-y-2 text-sm">
                {acabando.map((k) => {
                  const nome = opcoes.pacientes.find((p) => p.id === k.paciente_id)?.nome ?? "Paciente";
                  return (
                    <li key={k.id} className="flex items-center justify-between gap-2">
                      <Link href={`${base}/pacientes/${k.paciente_id}`} className="min-w-0 truncate font-medium text-primary hover:underline">
                        {nome}
                      </Link>
                      <span className="numero shrink-0 text-muted-foreground">
                        {k.usadas}/{k.sessoes}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EstadoVazio icone={PackageOpen} titulo="Nenhum pacote acabando" />
            )}
            <Button asChild variante="contorno" tamanho="sm" className="mt-4 w-full">
              <Link href={`${base}/agenda`}>Ver a agenda da semana</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
