"use client";

import * as React from "react";
import { Landmark, PlugZap, Power, RefreshCw, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { conferirCobrancaNoBanco, ligarSicredi, removerSicredi, salvarCredenciaisSicredi, testarSicredi } from "@/lib/honorarios/acoes-banco";

export function FormSicredi({ cadastrado }: { cadastrado: boolean }) {
  const [ambiente, setAmbiente] = React.useState("producao");
  return (
    <FormularioAcao acao={salvarCredenciaisSicredi} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Ambiente" htmlFor="sic-amb">
              <Select id="sic-amb" name="ambiente" value={ambiente} onChange={(e) => setAmbiente(e.target.value)}>
                <option value="producao">Produção (cobranças reais)</option>
                <option value="homologacao">Homologação (teste do Sicredi)</option>
              </Select>
            </Campo>
            <Campo rotulo="Client ID" htmlFor="sic-id" erro={estado.erros?.client_id}>
              <Input id="sic-id" name="client_id" autoComplete="off" />
            </Campo>
          </div>
          {ambiente === "homologacao" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Endereço do token (homologação)" htmlFor="sic-tk">
                <Input id="sic-tk" name="url_token" placeholder="https://..." />
              </Campo>
              <Campo rotulo="Endereço da API (homologação)" htmlFor="sic-api" erro={estado.erros?.url_api}>
                <Input id="sic-api" name="url_api" placeholder="https://.../api/v2" />
              </Campo>
            </div>
          ) : null}
          <Campo rotulo="Client Secret" htmlFor="sic-secret" erro={estado.erros?.client_secret}>
            <Input id="sic-secret" name="client_secret" type="password" autoComplete="new-password" />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Certificado assinado pelo Sicredi" htmlFor="sic-cert" erro={estado.erros?.certificado} ajuda=".cer, .crt ou .pem (baixado no Portal do Desenvolvedor)">
              <Input id="sic-cert" name="certificado" type="file" accept=".cer,.crt,.pem,.der" />
            </Campo>
            <Campo rotulo="Chave privada" htmlFor="sic-chave" erro={estado.erros?.chave} ajuda=".key ou .pem (a do mesmo certificado)">
              <Input id="sic-chave" name="chave" type="file" accept=".key,.pem" />
            </Campo>
          </div>
          {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Guardando...">
              <Landmark /> {cadastrado ? "Trocar credenciais" : "Guardar credenciais"}
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function AcoesSicredi({ cadastrado, testeOk, ativo }: { cadastrado: boolean; testeOk: boolean; ativo: boolean }) {
  if (!cadastrado) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <BotaoAcao variante="contorno" acao={() => testarSicredi()}>
        <PlugZap /> Testar conexão
      </BotaoAcao>
      {testeOk ? (
        <BotaoAcao
          variante={ativo ? "fantasma" : "primario"}
          acao={() => ligarSicredi(!ativo)}
          confirmar={
            ativo
              ? undefined
              : { titulo: "Ligar a confirmação automática?", descricao: "As próximas cobranças enviadas serão criadas no Sicredi, e o pagamento dará baixa sozinho, com o recibo.", textoConfirmar: "Ligar" }
          }
        >
          <Power /> {ativo ? "Desligar" : "Ligar a confirmação automática"}
        </BotaoAcao>
      ) : null}
      <BotaoAcao variante="fantasma" acao={() => removerSicredi()} confirmar={{ titulo: "Apagar as credenciais do Sicredi?", descricao: "A confirmação automática para e volta o Pix comum.", textoConfirmar: "Apagar", perigo: true }}>
        <Trash2 /> Apagar credenciais
      </BotaoAcao>
    </div>
  );
}

export function ConferirNoBanco({ id, criar }: { id: string; criar: boolean }) {
  return (
    <BotaoAcao variante="contorno" tamanho="sm" acao={() => conferirCobrancaNoBanco(id)}>
      <RefreshCw /> {criar ? "Criar no banco agora" : "Conferir pagamento no banco"}
    </BotaoAcao>
  );
}
