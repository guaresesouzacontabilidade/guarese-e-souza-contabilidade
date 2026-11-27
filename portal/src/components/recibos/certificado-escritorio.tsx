"use client";

import { FileKey2, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input } from "@/components/ui/form";
import { cadastrarCertificadoEscritorio, removerCertificadoEscritorio } from "@/lib/assinatura/acoes";

/** Envio (ou troca) do certificado A1 do escritório e remoção. */
export function CertificadoEscritorio({ cadastrado }: { cadastrado: boolean }) {
  return (
    <div className="mt-3 space-y-3">
      <FormularioAcao acao={cadastrarCertificadoEscritorio} manterAoErrar className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        {({ estado, pendente }) => (
          <>
            <Campo rotulo={cadastrado ? "Trocar o certificado (A1)" : "Certificado A1 (.pfx ou .p12)"} htmlFor="cert-escritorio-arquivo" erro={estado.erros?.arquivo}>
              <Input id="cert-escritorio-arquivo" name="arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" />
            </Campo>
            <Campo rotulo="Senha do certificado" htmlFor="cert-escritorio-senha" erro={estado.erros?.senha}>
              <Input id="cert-escritorio-senha" name="senha" type="password" autoComplete="off" />
            </Campo>
            <BotaoEnviar pendente={pendente} textoPendente="Conferindo...">
              <FileKey2 /> {cadastrado ? "Trocar" : "Cadastrar"}
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
      {cadastrado ? (
        <BotaoAcao
          variante="fantasma"
          tamanho="sm"
          acao={removerCertificadoEscritorio}
          confirmar={{
            titulo: "Remover o certificado do escritório?",
            descricao: "Ele é apagado do portal. Os recibos já assinados continuam válidos; os próximos saem sem assinatura digital.",
            textoConfirmar: "Remover",
            perigo: true,
          }}
        >
          <Trash2 /> Remover o certificado
        </BotaoAcao>
      ) : null}
    </div>
  );
}
