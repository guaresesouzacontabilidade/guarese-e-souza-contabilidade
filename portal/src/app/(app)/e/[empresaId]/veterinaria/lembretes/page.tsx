import type { Metadata } from "next";
import Link from "next/link";
import { Syringe } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { BotaoLembreteLigacao, BotaoLembreteWhatsapp } from "@/components/veterinaria/lembretes";
import { emailConfigurado } from "@/lib/email/enviar";
import { formatarData, formatarDataHora, formatarTelefone } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica, somarDias } from "@/lib/veterinaria/contexto";
import { ESPECIES, linkWhatsapp, mensagemLembrete } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Vacinas e retornos" };

interface Lembrete {
  tipo: "vacina" | "retorno";
  referencia_id: string;
  data_alvo: string;
  descricao: string;
  paciente_id: string;
  paciente: string;
  especie: string;
  tutor_id: string;
  tutor: string;
  telefone: string | null;
  email: string | null;
  aceita_whatsapp: boolean;
  aceita_email: boolean;
  agendado: boolean;
  avisos: { canal: string; em: string }[];
}

const PERIODOS = [7, 15, 30, 60];
const CANAIS: Record<string, string> = { whatsapp: "WhatsApp", email: "e-mail", telefone: "ligação" };

export default async function PaginaLembretes({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/lembretes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const dias = PERIODOS.includes(Number(sp.dias)) ? Number(sp.dias) : 15;
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data }, { data: cfg }, { data: emp }] = await Promise.all([
    ctx.supabase.rpc("vet_lembretes_pendentes", { p_empresa_id: empresaId, p_ate: somarDias(hoje, dias) }),
    ctx.supabase.from("vet_config").select("nome_clinica, mensagem_vacina, mensagem_retorno, lembrete_email, lembrete_dias_antes").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("razao_social, nome_fantasia").eq("id", empresaId).maybeSingle(),
  ]);
  const lista = (data ?? []) as unknown as Lembrete[];
  const clinica = cfg?.nome_clinica ?? emp?.nome_fantasia ?? emp?.razao_social ?? "clínica";
  const email = emailConfigurado();

  return (
    <>
      <CabecalhoPagina
        titulo="Vacinas e retornos"
        descricao="Quem precisa voltar: a próxima dose de cada vacina (a última aplicada) e os retornos marcados no prontuário. Avise pelo WhatsApp da clínica com a mensagem pronta."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Até:</span>
        {PERIODOS.map((d) => (
          <Link key={d} href={`${base}/lembretes?dias=${d}`} className={`rounded-full border px-3 py-1 ${d === dias ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
            {d} dias
          </Link>
        ))}
      </div>
      <Alerta tom="info" className="mb-4">
        {cfg?.lembrete_email
          ? email
            ? `E-mail automático ligado: quem autorizou recebe ${cfg.lembrete_dias_antes} dia(s) antes, todo dia de manhã.`
            : "E-mail automático ligado na clínica, mas o envio de e-mail do portal ainda não foi configurado pelo escritório: nenhum e-mail sai até lá."
          : "E-mail automático desligado (Configurações da clínica). O WhatsApp abre no aparelho da clínica com a mensagem pronta: é só enviar."}
      </Alerta>
      {lista.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Animal e motivo</Th>
                  <Th className="hidden md:table-cell">Tutor</Th>
                  <Th>Aviso</Th>
                  <Th className="text-right">Avisar</Th>
                </Tr>
              </THead>
              <TBody>
                {lista.map((l) => {
                  const texto = mensagemLembrete((l.tipo === "vacina" ? cfg?.mensagem_vacina : cfg?.mensagem_retorno) ?? "", {
                    clinica,
                    tutor: l.tutor,
                    animal: l.paciente,
                    vacina: l.descricao,
                    data: l.data_alvo,
                  });
                  const wa = l.aceita_whatsapp ? linkWhatsapp(l.telefone, texto) : null;
                  const atrasado = l.data_alvo < hoje;
                  return (
                    <Tr key={`${l.referencia_id}-${l.data_alvo}`}>
                      <Td className="numero align-top">
                        <span className={atrasado ? "font-medium text-perigo" : ""}>{formatarData(l.data_alvo)}</span>
                        {atrasado ? <span className="block text-xs text-perigo">atrasado</span> : null}
                      </Td>
                      <Td className="align-top">
                        <Link href={`${base}/pacientes/${l.paciente_id}`} className="font-medium text-primary hover:underline">
                          {l.paciente}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">({ESPECIES[l.especie] ?? l.especie})</span>
                        <span className="block text-xs">{l.tipo === "vacina" ? `Vacina: ${l.descricao}` : `Retorno: ${l.descricao}`}</span>
                        {l.agendado ? <Badge variante="sucesso">já agendado</Badge> : null}
                      </Td>
                      <Td className="hidden align-top md:table-cell">
                        <Link href={`${base}/tutores/${l.tutor_id}`} className="hover:underline">
                          {l.tutor}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{l.telefone ? formatarTelefone(l.telefone) : "sem telefone"}</span>
                      </Td>
                      <Td className="align-top text-xs">
                        {l.avisos.length ? (
                          l.avisos.slice(0, 2).map((a, i) => (
                            <span key={i} className="block">
                              {CANAIS[a.canal] ?? a.canal} · {formatarDataHora(a.em)}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">não avisado</span>
                        )}
                      </Td>
                      <Td className="align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {wa ? (
                            <BotaoLembreteWhatsapp empresaId={empresaId} tipo={l.tipo} referenciaId={l.referencia_id} link={wa} />
                          ) : (
                            <span className="self-center text-xs text-muted-foreground">{l.aceita_whatsapp ? "sem celular" : "não autorizou WhatsApp"}</span>
                          )}
                          <BotaoLembreteLigacao empresaId={empresaId} tipo={l.tipo} referenciaId={l.referencia_id} />
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={Syringe} titulo="Ninguém para lembrar neste período" descricao="As próximas doses entram aqui quando a vacina é registrada; os retornos, quando o veterinário marca no prontuário." />
      )}
    </>
  );
}
