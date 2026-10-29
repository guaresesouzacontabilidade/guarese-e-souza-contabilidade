"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarAviso } from "@/lib/veterinaria/acoes";

/**
 * Abre o WhatsApp do aparelho da clínica com o lembrete pronto (o envio é
 * feito pela própria clínica, no aplicativo) e registra no histórico que o
 * tutor foi avisado. Nada é enviado pelo portal.
 */
export function BotaoLembreteWhatsapp({
  empresaId,
  tipo,
  referenciaId,
  link,
}: {
  empresaId: string;
  tipo: "vacina" | "retorno";
  referenciaId: string;
  link: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  return (
    <Button
      asChild
      tamanho="sm"
      variante="sucesso"
      aria-disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await registrarAviso(empresaId, { tipo, referencia_id: referenciaId, canal: "whatsapp" });
          if (!r.ok) toast.error(r.mensagem ?? "Não foi possível registrar o aviso.");
          router.refresh();
        })
      }
    >
      <a href={link} target="_blank" rel="noopener noreferrer">
        <MessageCircle /> WhatsApp
      </a>
    </Button>
  );
}

/** Registra que a recepção ligou para o tutor. */
export function BotaoLembreteLigacao({ empresaId, tipo, referenciaId }: { empresaId: string; tipo: "vacina" | "retorno"; referenciaId: string }) {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  return (
    <Button
      variante="fantasma"
      tamanho="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await registrarAviso(empresaId, { tipo, referencia_id: referenciaId, canal: "telefone" });
          if (r.ok) toast.success(r.mensagem ?? "Registrado.");
          else toast.error(r.mensagem ?? "Não foi possível registrar.");
          router.refresh();
        })
      }
    >
      <Phone /> Liguei
    </Button>
  );
}
