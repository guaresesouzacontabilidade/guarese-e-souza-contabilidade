"use client";

import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { configurarIa, removerChaveIa, salvarChaveIa, testarIa } from "@/lib/escalas/acoes-ia-config";
import { configurarSuporteIa } from "@/lib/suporte/acoes";

export interface ConfigIaTela {
  ativa: boolean;
  chave_final: string | null;
  modelo: string;
  limite_diario: number;
}

/** Configuração do assistente de IA das escalas (administrador do escritório). */
export function ConfigurarIa({ cfg, modelos }: { cfg: ConfigIaTela; modelos: readonly { id: string; rotulo: string }[] }) {
  return (
    <div className="space-y-4">
      <FormularioAcao acao={salvarChaveIa} resetarAoSucesso className="space-y-2">
        {({ estado, pendente }) => (
          <>
            <Campo
              rotulo={cfg.chave_final ? `Chave cadastrada (termina em …${cfg.chave_final}). Para trocar, cole a nova:` : "Chave da API da Anthropic"}
              htmlFor="chave-ia"
              erro={estado.erros?.chave}
              ajuda="Crie em console.anthropic.com → API Keys. Ela é testada, guardada cifrada e nunca mais aparece na tela."
            >
              <Input id="chave-ia" name="chave" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." />
            </Campo>
            <BotaoEnviar pendente={pendente} variante="contorno" tamanho="sm" textoPendente="Testando e guardando...">
              <KeyRound /> Guardar chave
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
      <FormularioAcao acao={configurarIa} className="space-y-3">
        {({ estado, pendente }) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Modelo" htmlFor="modelo-ia">
                <Select id="modelo-ia" name="modelo" defaultValue={cfg.modelo}>
                  {modelos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Limite de pedidos por dia, por empresa" htmlFor="limite-ia" erro={estado.erros?.limite_diario}>
                <Input id="limite-ia" name="limite_diario" type="number" min={1} max={500} defaultValue={cfg.limite_diario} />
              </Campo>
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <Checkbox name="ativa" defaultChecked={cfg.ativa} disabled={!cfg.chave_final} className="mt-0.5" />
              <span>
                Ligar o assistente nas escalas de trabalho
                {!cfg.chave_final ? <span className="block text-xs text-muted-foreground">Cadastre a chave primeiro.</span> : null}
              </span>
            </label>
            <BotaoEnviar pendente={pendente} tamanho="sm">
              Salvar configuração
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
      {cfg.chave_final ? (
        <div className="flex flex-wrap gap-2">
          <BotaoAcao variante="contorno" tamanho="sm" acao={testarIa}>
            <PlugZap /> Testar conexão
          </BotaoAcao>
          <BotaoAcao
            variante="fantasma"
            tamanho="sm"
            acao={removerChaveIa}
            confirmar={{ titulo: "Remover a chave da Anthropic?", descricao: "O assistente fica desconectado em todas as empresas.", textoConfirmar: "Remover", perigo: true }}
          >
            <Trash2 /> Remover chave
          </BotaoAcao>
        </div>
      ) : null}
    </div>
  );
}

/** Assistente de IA no suporte 24h dos clientes (administrador do escritório). */
export function ConfigurarSuporteIa({ ativo, limite, temChave }: { ativo: boolean; limite: number; temChave: boolean }) {
  return (
    <FormularioAcao acao={configurarSuporteIa} className="space-y-3 border-t border-border pt-3">
      {({ estado, pendente }) => (
        <>
          <p className="text-sm font-medium text-foreground">Suporte 24h (botão “Ajuda” do portal)</p>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <Checkbox name="suporte_ativo" defaultChecked={ativo} disabled={!temChave} className="mt-0.5" />
            <span>
              Usar o assistente para escrever as respostas do suporte
              <span className="block text-xs text-muted-foreground">
                {temChave
                  ? "Vai só a pergunta, os trechos do guia de uso e os nomes das telas — nenhum dado da empresa. Desligado, o suporte responde pela busca no guia."
                  : "Cadastre a chave primeiro. Enquanto isso, o suporte responde pela busca no guia."}
              </span>
            </span>
          </label>
          <Campo rotulo="Perguntas por pessoa por dia" htmlFor="suporte-limite" erro={estado.erros?.suporte_limite_usuario}>
            <Input id="suporte-limite" name="suporte_limite_usuario" type="number" min={1} max={500} defaultValue={limite} className="w-32" />
          </Campo>
          <BotaoEnviar pendente={pendente} tamanho="sm" variante="contorno">
            Salvar suporte
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}
