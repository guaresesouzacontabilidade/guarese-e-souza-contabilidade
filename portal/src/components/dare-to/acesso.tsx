"use client";

import * as React from "react";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { removerAcessoDareTo, salvarAcessoDareTo, testarAcessoDareTo } from "@/lib/dare-to/acoes";
import { formatarDataHora } from "@/lib/formatos";

export interface AcessoDareToTela {
  login_mascarado: string;
  situacao: "nao_testado" | "conectado" | "erro";
  ultimo_teste_em: string | null;
  ultima_mensagem: string | null;
}

/**
 * Acesso do escritório ao sistema de DARE da SEFAZ-TO (login do governo do
 * Tocantins). A senha vai cifrada para o servidor e nunca volta para a tela.
 */
export function AcessoDareTo({ acesso, oficial, demonstracao }: { acesso: AcessoDareToTela | null; oficial: boolean; demonstracao: boolean }) {
  const [trocar, setTrocar] = React.useState(false);

  if (acesso && !trocar) {
    return (
      <div className="space-y-3">
        <p>
          Acesso cadastrado: <span className="font-medium text-foreground">{acesso.login_mascarado}</span>
          {acesso.ultimo_teste_em ? <> · último teste em {formatarDataHora(acesso.ultimo_teste_em)}</> : <> · ainda não testado</>}
        </p>
        {acesso.ultima_mensagem ? (
          <p className={acesso.situacao === "erro" ? "text-perigo" : acesso.situacao === "conectado" ? "text-sucesso-fg" : ""}>{acesso.ultima_mensagem}</p>
        ) : null}
        {!oficial ? <p className="text-xs">Fora do portal oficial o teste não acessa a SEFAZ-TO.</p> : null}
        <div className="flex flex-wrap gap-2">
          <BotaoAcao acao={testarAcessoDareTo} tamanho="sm" disabled={!oficial}>
            <PlugZap /> Testar conexão
          </BotaoAcao>
          <Button type="button" variante="contorno" tamanho="sm" onClick={() => setTrocar(true)}>
            <KeyRound /> Trocar acesso
          </Button>
          <BotaoAcao
            acao={removerAcessoDareTo}
            variante="fantasma"
            tamanho="sm"
            confirmar={{ titulo: "Remover o acesso à SEFAZ-TO?", descricao: "O robô do DARE fica desconectado até um novo acesso ser cadastrado. Os DAREs já emitidos continuam nas empresas.", textoConfirmar: "Remover", perigo: true }}
          >
            <Trash2 /> Remover
          </BotaoAcao>
        </div>
      </div>
    );
  }

  return (
    <FormularioAcao acao={salvarAcessoDareTo} className="space-y-3" resetarAoSucesso aoSucesso={() => setTrocar(false)}>
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="CPF ou e-mail" htmlFor="dare-login" erro={estado.erros?.login} ajuda="O mesmo login usado nos sistemas do governo do Tocantins (TOauth).">
              <Input id="dare-login" name="login" autoComplete="off" spellCheck={false} disabled={demonstracao} />
            </Campo>
            <Campo rotulo="Senha" htmlFor="dare-senha" erro={estado.erros?.senha} ajuda="Guardada cifrada no servidor; ninguém consegue ver depois.">
              <Input id="dare-senha" name="senha" type="password" autoComplete="new-password" disabled={demonstracao} />
            </Campo>
          </div>
          {demonstracao ? <p className="text-xs">Na demonstração não se cadastra o acesso real (os dados aqui são fictícios).</p> : null}
          <div className="flex flex-wrap gap-2">
            <BotaoEnviar pendente={pendente} tamanho="sm" textoPendente="Guardando..." disabled={demonstracao}>
              <KeyRound /> Guardar acesso
            </BotaoEnviar>
            {acesso ? (
              <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setTrocar(false)}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
