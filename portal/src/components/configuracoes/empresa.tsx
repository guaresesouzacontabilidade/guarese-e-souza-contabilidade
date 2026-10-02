"use client";

import { Save } from "lucide-react";
import { Checkbox } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { salvarPreferenciaEmail } from "@/app/(app)/e/[empresaId]/configuracoes/acoes";

/** Preferência pessoal de notificações por e-mail. */
export function PreferenciaNotificacoes({ emailAtivo }: { emailAtivo: boolean }) {
  return (
    <FormularioAcao acao={salvarPreferenciaEmail} className="space-y-3">
      {({ pendente }) => (
        <>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <Checkbox name="email_notificacoes" defaultChecked={emailAtivo} className="mt-0.5" />
            <span>
              <span className="font-medium">Receber as notificações também por e-mail</span>
              <span className="block text-xs text-muted-foreground">
                Documentos publicados, pendências, mensagens e lembretes. Os avisos continuam aparecendo no portal. A preferência vale para todas as
                empresas que você acessa.
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} variante="contorno">
              <Save /> Salvar preferência
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
