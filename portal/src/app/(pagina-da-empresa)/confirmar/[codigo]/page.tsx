import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck, CalendarX, MapPin, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RespostaConfirmacao } from "@/components/fisioterapia/confirmar-publico";
import { criarClienteServidor } from "@/lib/supabase/server";
import { formatarTelefone } from "@/lib/formatos";

export const metadata: Metadata = { title: "Confirme seu atendimento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Confirmacao {
  paciente: string | null;
  inicio: string;
  duracao_min: number;
  status: string;
  resposta: string | null;
  pode_responder: boolean;
  clinica: string;
  telefone: string | null;
  endereco: string | null;
}

const FUSO = "America/Araguaina";
const dia = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: FUSO }).format(new Date(iso));
const hora = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO }).format(new Date(iso));

/**
 * Link de confirmação enviado pelo WhatsApp da clínica (sem login). Mostra só o
 * primeiro nome, o dia, a hora e os contatos da clínica; o paciente confirma ou
 * avisa que não vai.
 */
export default async function ConfirmarAtendimento({ params }: PageProps<"/confirmar/[codigo]">) {
  const { codigo } = await params;
  if (!/^[a-z0-9]{16}$/.test(codigo)) notFound();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("fisio_confirmacao_ver", { p_codigo: codigo });
  const c = data as unknown as Confirmacao | null;
  if (!c) notFound();
  const tel = (c.telefone ?? "").replace(/\D/g, "");

  return (
    <Card className="w-full max-w-md" data-testid="confirmacao-paciente">
      <CardHeader className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.clinica}</p>
        <CardTitle className="text-xl">{c.paciente ? `Olá, ${c.paciente}!` : "Olá!"}</CardTitle>
        <p className="text-sm text-muted-foreground">Seu atendimento está marcado para</p>
        <p className="text-lg font-semibold first-letter:uppercase">
          {dia(c.inicio)} às {hora(c.inicio)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.resposta === "confirmou" || (c.status === "confirmado" && !c.pode_responder) ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-sucesso-bg p-3 text-center text-sm font-medium text-sucesso-fg">
            <CalendarCheck className="size-5" /> Presença confirmada. Até logo!
          </p>
        ) : c.resposta === "desmarcou" || c.status === "cancelado" ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-muted p-3 text-center text-sm">
            <CalendarX className="size-5" /> Este horário foi desmarcado. Para remarcar, fale com a clínica.
          </p>
        ) : c.pode_responder ? (
          <>
            {c.status === "confirmado" ? <p className="text-center text-sm text-sucesso">A clínica já registrou a sua confirmação.</p> : null}
            <RespostaConfirmacao codigo={codigo} />
          </>
        ) : (
          <p className="rounded-lg bg-muted p-3 text-center text-sm">Este horário não pode mais ser alterado por aqui. Fale com a clínica.</p>
        )}
        {c.resposta === "confirmou" && c.pode_responder ? (
          <p className="text-center text-xs text-muted-foreground">Se não puder mais vir, avise a clínica pelo telefone abaixo.</p>
        ) : null}
        <div className="space-y-1.5 border-t border-border pt-3 text-sm">
          {c.endereco ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {c.endereco}
            </p>
          ) : null}
          {tel ? (
            <p className="flex items-center gap-2">
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              <a href={`tel:+55${tel}`} className="text-primary underline-offset-2 hover:underline">
                {formatarTelefone(tel)}
              </a>
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
