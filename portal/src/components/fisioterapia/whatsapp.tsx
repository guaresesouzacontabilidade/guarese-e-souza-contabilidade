"use client";

import * as React from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input } from "@/components/ui/form";
import { formatarTelefone } from "@/lib/formatos";
import { MODELO_CONFIRMACAO_SUGERIDO } from "@/lib/fisioterapia/rotulos";
import { configurarWhatsappFisio, testarWhatsappFisio } from "@/lib/fisioterapia/whatsapp-acoes";

export interface ConfigWhatsappFisio {
  whatsapp_ativo: boolean;
  whatsapp_phone_number_id: string | null;
  whatsapp_modelo: string | null;
  whatsapp_idioma: string;
  whatsapp_hora_envio: string;
  whatsapp_modo_teste: boolean;
  whatsapp_numero_teste: string | null;
}

/**
 * Confirmação do atendimento pelo WhatsApp oficial da clínica: no dia do
 * atendimento, o paciente recebe o link para confirmar ou desmarcar. Começa no
 * modo teste (tudo vai para o número de teste) até a clínica desligar o teste.
 */
export function FormWhatsappFisio({ empresaId, cfg, temToken, tokenEscritorio }: { empresaId: string; cfg: ConfigWhatsappFisio; temToken: boolean; tokenEscritorio: boolean }) {
  const [teste, setTeste] = React.useState(cfg.whatsapp_numero_teste ? formatarTelefone(cfg.whatsapp_numero_teste) : "");
  const [modoTeste, setModoTeste] = React.useState(cfg.whatsapp_modo_teste);
  const [testando, iniciar] = React.useTransition();
  const conectado = cfg.whatsapp_ativo && Boolean(cfg.whatsapp_phone_number_id && cfg.whatsapp_modelo) && (temToken || tokenEscritorio);
  return (
    <FormularioAcao acao={configurarWhatsappFisio.bind(null, empresaId)} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="flex flex-wrap items-center gap-2" data-testid="situacao-whatsapp-clinica">
            {conectado ? (
              <Badge variante="sucesso">Ligada</Badge>
            ) : cfg.whatsapp_ativo ? (
              <Badge variante="alerta">Ligada, mas falta o token: nada é enviado</Badge>
            ) : (
              <Badge variante="alerta">Desligada</Badge>
            )}
            {cfg.whatsapp_ativo && cfg.whatsapp_modo_teste ? (
              <Badge variante="info">Modo teste: só para {cfg.whatsapp_numero_teste ? formatarTelefone(cfg.whatsapp_numero_teste) : "o número de teste"}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            No dia do atendimento, no horário escolhido, o paciente recebe pelo <strong>WhatsApp oficial da clínica</strong> um link para <strong>confirmar a presença</strong> ou{" "}
            <strong>avisar que não vai</strong>. A agenda mostra a resposta e a recepção é avisada de quem desmarcou. Até configurar, nada é enviado (o botão “WhatsApp” da agenda
            continua abrindo o WhatsApp com a mensagem pronta).
          </p>
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Como ligar e testar com outro número (passo a passo)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Na Meta (developers.facebook.com → seu app → WhatsApp → Configuração da API), a Meta dá um <strong>número de teste gratuito</strong>. Cadastre ali o celular que vai
                receber os testes (até 5 números).
              </li>
              <li>
                Crie o modelo de mensagem da categoria <strong>Utilidade</strong>, em português, com 4 variáveis. Sugestão: <em>{MODELO_CONFIRMACAO_SUGERIDO}</em>
              </li>
              <li>Cole aqui o Phone Number ID do número (o de teste, por enquanto), o nome do modelo e o token de acesso.</li>
              <li>
                Deixe <strong>Modo teste</strong> marcado com o seu celular: todas as confirmações vão só para ele, nunca para os pacientes. Use “Enviar confirmação (teste)” num
                horário da agenda e abra o link.
              </li>
              <li>Deu tudo certo? Troque o Phone Number ID pelo do número oficial da clínica (com o token dele) e desmarque o modo teste.</li>
            </ol>
          </details>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="whatsapp_ativo" defaultChecked={cfg.whatsapp_ativo} /> Ligar a confirmação pelo WhatsApp
          </label>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Phone Number ID" htmlFor="fw-phone">
              <Input id="fw-phone" name="whatsapp_phone_number_id" inputMode="numeric" defaultValue={cfg.whatsapp_phone_number_id ?? ""} autoComplete="off" />
            </Campo>
            <Campo rotulo="Nome do modelo aprovado" htmlFor="fw-modelo">
              <Input id="fw-modelo" name="whatsapp_modelo" defaultValue={cfg.whatsapp_modelo ?? ""} placeholder="confirmacao_atendimento" autoComplete="off" />
            </Campo>
            <Campo rotulo="Idioma do modelo" htmlFor="fw-idioma">
              <Input id="fw-idioma" name="whatsapp_idioma" defaultValue={cfg.whatsapp_idioma} autoComplete="off" />
            </Campo>
            <Campo rotulo="Horário do envio (no dia do atendimento)" htmlFor="fw-hora" erro={estado.erros?.whatsapp_hora_envio} ajuda="Horário marcado depois disso no mesmo dia: sai na hora.">
              <Input id="fw-hora" name="whatsapp_hora_envio" type="time" defaultValue={cfg.whatsapp_hora_envio.slice(0, 5)} />
            </Campo>
            <Campo
              rotulo="Token de acesso"
              htmlFor="fw-token"
              erro={estado.erros?.whatsapp_token}
              className="sm:col-span-2"
              ajuda={
                temToken
                  ? "Token guardado (cifrado). Deixe em branco para manter."
                  : tokenEscritorio
                    ? "Opcional: sem token próprio, usa a conexão do escritório (o número precisa estar no mesmo portfólio da Meta)."
                    : "Fica guardado cifrado no servidor e nunca volta para a tela."
              }
            >
              <Input id="fw-token" name="whatsapp_token" type="password" autoComplete="new-password" placeholder={temToken ? "••••••••••••" : ""} />
            </Campo>
          </div>
          {temToken ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="remover_token" /> Apagar o token guardado
            </label>
          ) : null}
          <div className="space-y-2 rounded-lg border border-info/40 bg-info-bg/40 p-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="whatsapp_modo_teste" checked={modoTeste} onChange={(e) => setModoTeste(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Modo teste</strong>: todas as confirmações vão para o número de teste, nunca para os pacientes
              </span>
            </label>
            <Campo rotulo="Número de teste (celular com DDD)" htmlFor="fw-teste">
              <Input id="fw-teste" name="whatsapp_numero_teste" inputMode="tel" value={teste} onChange={(e) => setTeste(e.target.value)} placeholder="(63) 99999-0000" />
            </Campo>
            {!modoTeste ? <Alerta tom="alerta">Sem o modo teste, as confirmações vão para os pacientes de verdade (os que autorizaram o WhatsApp no cadastro).</Alerta> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variante="contorno"
              disabled={testando || teste.replace(/\D/g, "").length < 10}
              onClick={() =>
                iniciar(async () => {
                  const r = await testarWhatsappFisio(empresaId, teste);
                  if (r.ok) toast.success(r.mensagem ?? "Teste enviado.");
                  else toast.error(r.mensagem ?? "Não foi possível enviar o teste.");
                })
              }
              title="Manda o modelo com dados de exemplo para o número de teste (salve antes as mudanças)"
            >
              <Send /> Enviar mensagem de teste
            </Button>
            <BotaoEnviar pendente={pendente}>Salvar confirmação pelo WhatsApp</BotaoEnviar>
          </div>
          <p className="text-xs text-muted-foreground">
            Vão para a Meta só o celular, o primeiro nome do paciente, o horário, o nome da clínica e o link — nada do prontuário. Só recebem os pacientes que autorizaram o
            WhatsApp no cadastro.
          </p>
        </>
      )}
    </FormularioAcao>
  );
}
