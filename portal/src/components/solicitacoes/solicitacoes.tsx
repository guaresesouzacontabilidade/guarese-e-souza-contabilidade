"use client";

import * as React from "react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { abrirSolicitacao, atualizarSolicitacao } from "@/lib/solicitacoes/acoes";
import { AREAS_SERVICO, STATUS_SOLICITACAO } from "@/lib/solicitacoes/rotulos";

export interface ServicoCatalogo {
  codigo: string;
  nome: string;
  descricao: string | null;
  area: string;
  prazo_dias: number;
  documentos_necessarios: string | null;
}

/** Nova solicitação: escolha do serviço (com o que costuma ser preciso enviar) e descrição. */
export function FormNovaSolicitacao({ empresaId, servicos, inicial }: { empresaId: string; servicos: ServicoCatalogo[]; inicial?: string }) {
  const [servico, setServico] = React.useState(inicial && servicos.some((s) => s.codigo === inicial) ? inicial : "");
  const escolhido = servicos.find((s) => s.codigo === servico);
  const porArea = Object.keys(AREAS_SERVICO)
    .map((a) => ({ area: a, itens: servicos.filter((s) => s.area === a) }))
    .filter((g) => g.itens.length);
  return (
    <FormularioAcao acao={abrirSolicitacao.bind(null, empresaId)} className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium">Qual serviço você precisa?</legend>
            {porArea.map((g) => (
              <div key={g.area} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{AREAS_SERVICO[g.area]}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.itens.map((s) => (
                    <label
                      key={s.codigo}
                      className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-bege/50"
                    >
                      <input
                        type="radio"
                        name="servico"
                        value={s.codigo}
                        checked={servico === s.codigo}
                        onChange={() => setServico(s.codigo)}
                        className="mt-1 size-4 accent-[var(--primary)]"
                      />
                      <span>
                        <span className="block text-sm font-medium">{s.nome}</span>
                        <span className="block text-xs text-muted-foreground">{s.descricao}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {estado.erros?.servico ? <p className="text-sm text-perigo">{estado.erros.servico[0]}</p> : null}
          </fieldset>
          {escolhido ? (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p>
                <span className="font-medium">Prazo estimado:</span> {escolhido.prazo_dias} {escolhido.prazo_dias === 1 ? "dia" : "dias"} (o escritório confirma).
              </p>
              {escolhido.documentos_necessarios ? (
                <p className="mt-1">
                  <span className="font-medium">Costuma ser preciso:</span> {escolhido.documentos_necessarios}
                </p>
              ) : null}
            </div>
          ) : null}
          <Campo rotulo="Resumo do pedido" htmlFor="sol-titulo" erro={estado.erros?.titulo} obrigatorio>
            <Input id="sol-titulo" name="titulo" maxLength={160} placeholder="Ex.: Mudança de endereço para a Rua Nova, 50" />
          </Campo>
          <Campo rotulo="Detalhes" htmlFor="sol-desc" ajuda="Depois de abrir, você pode mandar anexos e conversar com o escritório na conversa da solicitação.">
            <Textarea id="sol-desc" name="descricao" rows={4} maxLength={4000} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="urgente" /> É urgente
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Abrindo...">
              Abrir solicitação
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Andamento pela equipe: situação, responsável, prazo e comentário. */
export function FormAndamentoEquipe({
  empresaId,
  solicitacaoId,
  status,
  responsavelId,
  prazo,
  equipe,
}: {
  empresaId: string;
  solicitacaoId: string;
  status: string;
  responsavelId: string | null;
  prazo: string | null;
  equipe: { id: string; nome: string }[];
}) {
  return (
    <FormularioAcao acao={atualizarSolicitacao.bind(null, empresaId, solicitacaoId)} resetarAoSucesso className="space-y-3">
      {({ pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Situação" htmlFor="and-status">
              <Select id="and-status" name="status" defaultValue={status}>
                {Object.entries(STATUS_SOLICITACAO).map(([v, s]) => (
                  <option key={v} value={v}>
                    {s.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Responsável" htmlFor="and-resp">
              <Select id="and-resp" name="responsavel" defaultValue={responsavelId ?? ""}>
                <option value="">—</option>
                {equipe.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Prazo" htmlFor="and-prazo">
              <Input id="and-prazo" name="prazo" type="date" defaultValue={prazo ?? ""} />
            </Campo>
          </div>
          <Campo rotulo="Comentário para a empresa" htmlFor="and-com" ajuda="Obrigatório ao pedir algo à empresa (Aguardando a empresa) ou ao cancelar.">
            <Textarea id="and-com" name="comentario" rows={2} maxLength={2000} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Atualizar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Ações do cliente: devolver ao escritório depois de enviar o que faltava, ou cancelar. */
export function AcoesCliente({ empresaId, solicitacaoId, status }: { empresaId: string; solicitacaoId: string; status: string }) {
  const [modo, setModo] = React.useState<"responder" | "cancelar" | null>(null);
  // Mantém o formulário montado até a confirmação aparecer (a situação muda na mesma resposta).
  if (!["aberta", "aguardando_cliente"].includes(status) && !modo) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "aguardando_cliente" ? (
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setModo("responder")}>
            Já enviei o que foi pedido
          </button>
        ) : null}
        <button type="button" className="text-sm text-muted-foreground hover:underline" onClick={() => setModo("cancelar")}>
          Cancelar solicitação
        </button>
      </div>
      {modo ? (
        <FormularioAcao acao={atualizarSolicitacao.bind(null, empresaId, solicitacaoId)} aoSucesso={() => setModo(null)} className="space-y-2">
          {({ pendente }) => (
            <>
              <input type="hidden" name="status" value={modo === "responder" ? "em_andamento" : "cancelada"} />
              <Campo rotulo={modo === "responder" ? "O que você enviou" : "Motivo do cancelamento"} htmlFor="cli-com">
                <Textarea id="cli-com" name="comentario" rows={2} maxLength={2000} />
              </Campo>
              <div className="flex justify-end gap-2">
                <BotaoEnviar pendente={pendente} variante={modo === "cancelar" ? "perigo" : "primario"}>
                  {modo === "responder" ? "Avisar o escritório" : "Cancelar solicitação"}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      ) : null}
    </div>
  );
}
