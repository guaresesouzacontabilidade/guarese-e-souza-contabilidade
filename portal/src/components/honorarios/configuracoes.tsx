"use client";

import * as React from "react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { definirAcessoHonorarios, salvarConfiguracaoHonorarios } from "@/lib/honorarios/acoes";
import { MENSAGENS_PADRAO, TIPOS_MENSAGEM, VARIAVEIS_MENSAGEM, type TipoMensagem } from "@/lib/honorarios/mensagens";
import { TIPOS_CHAVE_PIX } from "@/lib/honorarios/pix";

type Config = {
  pix_chave: string | null;
  pix_tipo: string | null;
  pix_nome: string | null;
  pix_cidade: string | null;
  geracao_automatica: boolean;
  dia_geracao: number;
  aprovacao_automatica: boolean;
  competencia_referencia: string;
  cobrar_encargos: boolean;
  multa_percentual: number;
  juros_mes_percentual: number;
  robo_ativo: boolean;
  regua: number[];
  email_ativo: boolean;
  whatsapp_ativo: boolean;
  whatsapp_template: string | null;
  mensagens: unknown;
  recibo_automatico: boolean;
  recibo_publicar: boolean;
};

function Resultado({ estado }: { estado: { ok: boolean; mensagem?: string } }) {
  // O aviso de sucesso aparece no canto da tela; aqui fica só o erro
  if (!estado.mensagem || estado.ok) return null;
  return <Alerta tom="perigo">{estado.mensagem}</Alerta>;
}

export function FormPix({ cfg, sugestao }: { cfg: Config; sugestao: { nome: string; cidade: string } }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoHonorarios} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="parte" value="pix" />
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <Campo rotulo="Tipo da chave" htmlFor="pix-tipo" erro={estado.erros?.pix_tipo}>
              <Select id="pix-tipo" name="pix_tipo" defaultValue={cfg.pix_tipo ?? "cnpj"}>
                {Object.entries(TIPOS_CHAVE_PIX).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Chave Pix do escritório" htmlFor="pix-chave" erro={estado.erros?.pix_chave} ajuda="A chave cadastrada no banco do escritório. Deixe vazio para cobrar sem Pix.">
              <Input id="pix-chave" name="pix_chave" defaultValue={cfg.pix_chave ?? ""} autoComplete="off" />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome de quem recebe" htmlFor="pix-nome" erro={estado.erros?.pix_nome} ajuda="Até 25 letras, sem acentos (aparece para quem paga).">
              <Input id="pix-nome" name="pix_nome" maxLength={60} defaultValue={cfg.pix_nome ?? sugestao.nome} />
            </Campo>
            <Campo rotulo="Cidade" htmlFor="pix-cidade" erro={estado.erros?.pix_cidade} ajuda="Até 15 letras.">
              <Input id="pix-cidade" name="pix_cidade" maxLength={40} defaultValue={cfg.pix_cidade ?? sugestao.cidade} />
            </Campo>
          </div>
          <Resultado estado={estado} />
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar Pix</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormGeracao({ cfg }: { cfg: Config }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoHonorarios} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="parte" value="geracao" />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="geracao_automatica" defaultChecked={cfg.geracao_automatica} />
            <span>Gerar as cobranças do mês sozinho, pelas fichas dos clientes</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Dia de gerar" htmlFor="ger-dia" erro={estado.erros?.dia_geracao}>
              <Select id="ger-dia" name="dia_geracao" defaultValue={String(cfg.dia_geracao)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    Dia {d}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="A cobrança paga qual mês?" htmlFor="ger-ref">
              <Select id="ger-ref" name="competencia_referencia" defaultValue={cfg.competencia_referencia}>
                <option value="mes_anterior">O mês anterior (vence em novembro, referente a outubro)</option>
                <option value="mes_atual">O próprio mês (vence em novembro, referente a novembro)</option>
              </Select>
            </Campo>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="aprovacao_automatica" defaultChecked={cfg.aprovacao_automatica} />
            <span>Enviar direto aos clientes, sem conferência (sem marcar, elas ficam em “Para conferir”)</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="cobrar_encargos" defaultChecked={cfg.cobrar_encargos} />
            <span>Cobrar multa e juros depois do vencimento (o Pix dos lembretes já vem com o valor atualizado)</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Multa (%)" htmlFor="ger-multa" erro={estado.erros?.multa_percentual}>
              <Input id="ger-multa" name="multa_percentual" inputMode="decimal" defaultValue={String(cfg.multa_percentual).replace(".", ",")} />
            </Campo>
            <Campo rotulo="Juros ao mês (%)" htmlFor="ger-juros" erro={estado.erros?.juros_mes_percentual}>
              <Input id="ger-juros" name="juros_mes_percentual" inputMode="decimal" defaultValue={String(cfg.juros_mes_percentual).replace(".", ",")} />
            </Campo>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="recibo_automatico" defaultChecked={cfg.recibo_automatico} />
            <span>Ao registrar o pagamento, emitir o recibo (assinado com o certificado do escritório, quando cadastrado)</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="recibo_publicar" defaultChecked={cfg.recibo_publicar} />
            <span>Publicar o recibo nos documentos do cliente</span>
          </label>
          <Resultado estado={estado} />
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormRobo({ cfg, emailPronto, whatsappPronto }: { cfg: Config; emailPronto: boolean; whatsappPronto: boolean }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoHonorarios} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="parte" value="robo" />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="robo_ativo" defaultChecked={cfg.robo_ativo} />
            <span>Robô de cobrança ligado (lembretes automáticos das cobranças em aberto)</span>
          </label>
          <Campo
            rotulo="Quando lembrar (dias em relação ao vencimento)"
            htmlFor="robo-regua"
            erro={estado.erros?.regua}
            ajuda="Negativo = antes; 0 = no dia; positivo = depois. Ex.: -5, 0, 3, 10, 30. O envio é às 9h, só em dia útil; o que cair no fim de semana sai no próximo dia útil. A partir de 30 dias o texto vira aviso formal."
          >
            <Input id="robo-regua" name="regua" defaultValue={cfg.regua.join(", ")} />
          </Campo>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="email_ativo" defaultChecked={cfg.email_ativo} />
              <span>
                Enviar por e-mail {emailPronto ? <span className="text-sucesso">(conectado)</span> : <span className="text-alerta">(desconectado: configure o e-mail do portal)</span>}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="whatsapp_ativo" defaultChecked={cfg.whatsapp_ativo} />
              <span>
                Enviar por WhatsApp{" "}
                {whatsappPronto ? <span className="text-sucesso">(conectado)</span> : <span className="text-alerta">(desconectado até ativar o WhatsApp oficial da Meta e o modelo abaixo)</span>}
              </span>
            </label>
          </div>
          <Campo
            rotulo="Nome do modelo de mensagem aprovado na Meta"
            htmlFor="robo-modelo"
            erro={estado.erros?.whatsapp_template}
            ajuda="O modelo precisa de 4 variáveis: {{1}} cliente, {{2}} resumo da cobrança, {{3}} Pix copia e cola, {{4}} link de pagamento. Veja o texto sugerido no guia."
          >
            <Input id="robo-modelo" name="whatsapp_template" defaultValue={cfg.whatsapp_template ?? ""} placeholder="cobranca_honorarios" />
          </Campo>
          <Resultado estado={estado} />
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar robô</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormMensagens({ cfg }: { cfg: Config }) {
  const editadas = (cfg.mensagens && typeof cfg.mensagens === "object" ? cfg.mensagens : {}) as Record<string, { assunto?: string; texto?: string }>;
  const [tipo, setTipo] = React.useState<TipoMensagem>("emissao");
  return (
    <FormularioAcao acao={salvarConfiguracaoHonorarios} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="parte" value="mensagens" />
          <p className="text-sm text-muted-foreground">
            Variáveis: {Object.entries(VARIAVEIS_MENSAGEM).map(([v, d]) => (
              <span key={v} className="mr-2 inline-block">
                <code className="rounded bg-muted px-1">{`{${v}}`}</code> {d}
              </span>
            ))}
          </p>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de mensagem">
            {(Object.keys(TIPOS_MENSAGEM) as TipoMensagem[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tipo === t}
                onClick={() => setTipo(t)}
                className={`rounded-full border px-3 py-1 text-xs ${tipo === t ? "border-primary bg-secondary font-medium" : "border-border"}`}
              >
                {TIPOS_MENSAGEM[t]}
              </button>
            ))}
          </div>
          {(Object.keys(TIPOS_MENSAGEM) as TipoMensagem[]).map((t) => (
            <div key={t} className={tipo === t ? "space-y-3" : "hidden"}>
              <Campo rotulo="Assunto do e-mail" htmlFor={`msg-${t}-assunto`} ajuda="Vazio = texto padrão.">
                <Input id={`msg-${t}-assunto`} name={`${t}_assunto`} maxLength={200} defaultValue={editadas[t]?.assunto ?? ""} placeholder={MENSAGENS_PADRAO[t].assunto} />
              </Campo>
              <Campo rotulo="Texto" htmlFor={`msg-${t}-texto`} ajuda="Linha em branco separa parágrafos. O Pix e o PDF vão junto automaticamente.">
                <Textarea id={`msg-${t}-texto`} name={`${t}_texto`} rows={7} maxLength={2000} defaultValue={editadas[t]?.texto ?? ""} placeholder={MENSAGENS_PADRAO[t].texto} />
              </Campo>
            </div>
          ))}
          <Resultado estado={estado} />
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar mensagens</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function AcessoPessoa({ id, nome, ativo }: { id: string; nome: string; ativo: boolean }) {
  return (
    <BotaoAcao
      variante={ativo ? "fantasma" : "contorno"}
      tamanho="sm"
      acao={() => definirAcessoHonorarios(id, !ativo)}
      confirmar={
        ativo
          ? undefined
          : { titulo: `Liberar o financeiro do escritório para ${nome}?`, descricao: "A pessoa passa a ver e mexer nas cobranças, nos valores dos clientes e na DRE do escritório.", textoConfirmar: "Liberar" }
      }
    >
      {ativo ? "Retirar acesso" : "Liberar acesso"}
    </BotaoAcao>
  );
}
