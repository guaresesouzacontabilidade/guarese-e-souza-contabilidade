"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil, Plus, Send } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input } from "@/components/ui/form";
import { configurarExtrasOs, salvarSetorOs, testarWhatsappOs } from "@/lib/os/acoes";
import { MODELO_AVISO_SUGERIDO } from "@/lib/os/rotulos";

export interface SetorOs {
  id: string;
  nome: string;
  maquinas: number;
  ativo: boolean;
}

function FormSetor({ empresaId, s, aoSalvar }: { empresaId: string; s?: SetorOs; aoSalvar: () => void }) {
  return (
    <FormularioAcao acao={salvarSetorOs.bind(null, empresaId, s?.id ?? null)} aoSucesso={aoSalvar} manterAoErrar className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] [&>*]:min-w-0">
            <Campo rotulo="Setor ou máquina" htmlFor={`setor-nome-${s?.id ?? "novo"}`} obrigatorio erro={estado.erros?.nome}>
              <Input id={`setor-nome-${s?.id ?? "novo"}`} name="nome" defaultValue={s?.nome ?? ""} maxLength={60} placeholder="Ex.: Seccionadora" />
            </Campo>
            <Campo rotulo="Máquinas" htmlFor={`setor-maq-${s?.id ?? "novo"}`} ajuda="Ao mesmo tempo.">
              <Input id={`setor-maq-${s?.id ?? "novo"}`} name="maquinas" type="number" min={1} max={50} defaultValue={s?.maquinas ?? 1} />
            </Campo>
          </div>
          {s ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="ativo" value="on" defaultChecked={s.ativo} /> Ativo (conta na previsão)
              {/* Vem depois da caixa: desmarcada, o servidor recebe só o "off" */}
              <input type="hidden" name="ativo" value="off" />
            </label>
          ) : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{s ? "Salvar" : "Cadastrar setor"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Setores e máquinas: quantas trabalham ao mesmo tempo (a previsão espera a fila de cada uma). */
export function SetoresOs({ empresaId, setores }: { empresaId: string; setores: SetorOs[] }) {
  const [aberto, setAberto] = React.useState<string | null>(null);
  return (
    <div className="space-y-3">
      {setores.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="lista-setores">
          {setores.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={s.ativo ? "" : "opacity-60"}>
                <strong>{s.nome}</strong> · {s.maquinas} {s.maquinas === 1 ? "máquina" : "máquinas"} ao mesmo tempo
                {!s.ativo ? <Badge className="ml-2">desativado</Badge> : null}
              </span>
              <Dialog open={aberto === s.id} onOpenChange={(v) => setAberto(v ? s.id : null)}>
                <DialogTrigger asChild>
                  <Button tamanho="sm" variante="fantasma" aria-label={`Editar ${s.nome}`}>
                    <Pencil /> Editar
                  </Button>
                </DialogTrigger>
                <DialogContent titulo={`Editar ${s.nome}`} largura="sm">
                  <FormSetor empresaId={empresaId} s={s} aoSalvar={() => setAberto(null)} />
                </DialogContent>
              </Dialog>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Os setores aparecem aqui quando você escreve o “Setor ou máquina” nos serviços (ou cadastre abaixo).</p>
      )}
      <Dialog open={aberto === "novo"} onOpenChange={(v) => setAberto(v ? "novo" : null)}>
        <DialogTrigger asChild>
          <Button variante="contorno" tamanho="sm">
            <Plus /> Novo setor
          </Button>
        </DialogTrigger>
        <DialogContent titulo="Novo setor ou máquina" largura="sm">
          <FormSetor empresaId={empresaId} aoSalvar={() => setAberto(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface ConfigExtrasOs {
  whatsapp_ativo: boolean;
  whatsapp_phone_number_id: string | null;
  whatsapp_modelo: string | null;
  whatsapp_idioma: string;
  exigir_assinatura: boolean;
  exigir_pagamento_entrega: boolean;
}

/** Aviso automático pelo WhatsApp (número oficial da própria loja) e regras da entrega. */
export function FormExtrasOs({ empresaId, cfg, temToken, tokenEscritorio, loja }: { empresaId: string; cfg: ConfigExtrasOs | null; temToken: boolean; tokenEscritorio: boolean; loja: boolean }) {
  const [teste, setTeste] = React.useState("");
  const [testando, iniciar] = React.useTransition();
  const conectado = Boolean(cfg?.whatsapp_ativo && cfg.whatsapp_phone_number_id && cfg.whatsapp_modelo && (temToken || tokenEscritorio));
  return (
    <FormularioAcao acao={configurarExtrasOs.bind(null, empresaId)} manterAoErrar className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Aviso automático pelo WhatsApp</h3>
              {conectado ? <Badge variante="sucesso">Ligado</Badge> : <Badge variante="alerta">Desconectado</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Quando a OS fica pronta, o portal manda a mensagem sozinho pelo <strong>número oficial da loja no WhatsApp Business</strong> (Cloud API da Meta). Até configurar, nada é
              enviado: use o botão “Avisar” da esteira, que abre o WhatsApp com a mensagem pronta.
            </p>
            <details className="rounded-lg border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Como ligar (passo a passo)</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>No Gerenciador do WhatsApp da Meta (business.facebook.com), cadastre o número da loja na API do WhatsApp.</li>
                <li>
                  Crie um modelo de mensagem da categoria <strong>Utilidade</strong>, em português, com 4 variáveis. Sugestão: <em>{MODELO_AVISO_SUGERIDO}</em>
                </li>
                <li>Quando a Meta aprovar, copie o nome do modelo (ex.: os_pronta), o “Phone Number ID” do número e um token de acesso permanente.</li>
                <li>Cole tudo aqui, marque “Ligar o aviso automático” e salve. Use “Enviar teste” para conferir.</li>
              </ol>
            </details>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="whatsapp_ativo" defaultChecked={cfg?.whatsapp_ativo ?? false} /> Ligar o aviso automático quando a OS ficar pronta
            </label>
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Campo rotulo="Phone Number ID" htmlFor="wpp-phone" erro={estado.erros?.whatsapp_phone_number_id}>
                <Input id="wpp-phone" name="whatsapp_phone_number_id" inputMode="numeric" defaultValue={cfg?.whatsapp_phone_number_id ?? ""} autoComplete="off" />
              </Campo>
              <Campo rotulo="Nome do modelo aprovado" htmlFor="wpp-modelo">
                <Input id="wpp-modelo" name="whatsapp_modelo" defaultValue={cfg?.whatsapp_modelo ?? ""} placeholder="os_pronta" autoComplete="off" />
              </Campo>
              <Campo rotulo="Idioma do modelo" htmlFor="wpp-idioma">
                <Input id="wpp-idioma" name="whatsapp_idioma" defaultValue={cfg?.whatsapp_idioma ?? "pt_BR"} autoComplete="off" />
              </Campo>
              <Campo
                rotulo="Token de acesso"
                htmlFor="wpp-token"
                erro={estado.erros?.whatsapp_token}
                className="sm:col-span-3"
                ajuda={
                  temToken
                    ? "Token guardado (cifrado). Deixe em branco para manter."
                    : tokenEscritorio
                      ? "Opcional: sem token próprio, usa a conexão do escritório (o número precisa estar no mesmo portfólio da Meta)."
                      : "Cole o token permanente do número da loja. Fica guardado cifrado e nunca volta para a tela."
                }
              >
                <Input id="wpp-token" name="whatsapp_token" type="password" autoComplete="new-password" placeholder={temToken ? "••••••••••••" : ""} />
              </Campo>
            </div>
            {temToken ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="remover_token" /> Apagar o token guardado
              </label>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Campo rotulo="Enviar teste para o celular" htmlFor="wpp-teste" className="min-w-0 flex-1 sm:max-w-xs">
                <Input id="wpp-teste" inputMode="tel" value={teste} onChange={(e) => setTeste(e.target.value)} placeholder="(63) 99999-0000" />
              </Campo>
              <Button
                type="button"
                variante="contorno"
                disabled={testando || teste.replace(/\D/g, "").length < 10}
                onClick={() =>
                  iniciar(async () => {
                    const r = await testarWhatsappOs(empresaId, teste);
                    if (r.ok) toast.success(r.mensagem ?? "Teste enviado.");
                    else toast.error(r.mensagem ?? "Não foi possível enviar o teste.");
                  })
                }
              >
                <Send /> Enviar teste
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Vão para a Meta só o primeiro nome do cliente, o número da OS, o nome da loja e o link de acompanhamento. O cliente informou o telefone na abertura da OS e o aviso
              pode ser desmarcado em cada OS.
            </p>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Regras da entrega</h3>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="exigir_assinatura" defaultChecked={cfg?.exigir_assinatura ?? false} className="mt-0.5" />
              <span>
                Exigir a assinatura de quem retira (na tela do celular ou do computador)
                <span className="block text-xs text-muted-foreground">Sem marcar, a assinatura fica opcional no botão Entregar.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="exigir_pagamento_entrega" defaultChecked={cfg?.exigir_pagamento_entrega ?? false} className="mt-0.5" />
              <span>
                Só entregar com a OS paga (ou com o valor deixado “a receber”)
                <span className="block text-xs text-muted-foreground">O recebimento usa o caixa da Loja{loja ? "" : " (a Loja não está ligada para esta empresa)"}.</span>
              </span>
            </label>
          </section>
          {!loja ? <Alerta tom="info">Para receber sinal e restante pela OS, peça ao escritório para ligar a Loja (caixa) desta empresa.</Alerta> : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
