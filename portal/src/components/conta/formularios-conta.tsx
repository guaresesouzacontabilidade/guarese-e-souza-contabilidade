"use client";

import { KeyRound, Save } from "lucide-react";
import { Campo, Checkbox, Input } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { AJUDA_SENHA } from "@/lib/auth/senha";
import { formatarTelefone } from "@/lib/formatos";
import { alterarMinhaSenha, atualizarMeuPerfil } from "@/lib/conta/acoes";

export function FormularioPerfil({ nome, telefone }: { nome: string; telefone: string | null }) {
  return (
    <FormularioAcao acao={atualizarMeuPerfil} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome" htmlFor="conta-nome" obrigatorio erro={estado.erros?.nome}>
              <Input id="conta-nome" name="nome" defaultValue={nome} autoComplete="name" required />
            </Campo>
            <Campo rotulo="Telefone / WhatsApp" htmlFor="conta-telefone" erro={estado.erros?.telefone} ajuda="Com DDD. Opcional.">
              <Input
                id="conta-telefone"
                name="telefone"
                type="tel"
                inputMode="tel"
                defaultValue={telefone ? formatarTelefone(telefone) : ""}
                autoComplete="tel"
              />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>
              <Save /> Salvar dados
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormularioTrocaSenha() {
  return (
    <FormularioAcao acao={alterarMinhaSenha} resetarAoSucesso className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Senha atual" htmlFor="senha-atual" obrigatorio erro={estado.erros?.senha_atual}>
            <Input id="senha-atual" name="senha_atual" type="password" autoComplete="current-password" required />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nova senha" htmlFor="senha-nova" obrigatorio erro={estado.erros?.senha} ajuda={AJUDA_SENHA}>
              <Input id="senha-nova" name="senha" type="password" autoComplete="new-password" required />
            </Campo>
            <Campo rotulo="Confirme a nova senha" htmlFor="senha-confirmacao" obrigatorio erro={estado.erros?.confirmacao}>
              <Input id="senha-confirmacao" name="confirmacao" type="password" autoComplete="new-password" required />
            </Campo>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="encerrar_outras" defaultChecked className="mt-0.5" />
            <span>
              Encerrar as sessões em outros dispositivos
              <span className="block text-xs text-muted-foreground">Recomendado se você suspeita que alguém conhece a sua senha.</span>
            </span>
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Alterando...">
              <KeyRound /> Alterar senha
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
