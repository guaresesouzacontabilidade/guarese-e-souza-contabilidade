"use client";

import { Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Textarea } from "@/components/ui/form";
import { anotar, excluirAnotacao } from "@/lib/operacional/acoes";
import { formatarDataHora } from "@/lib/formatos";

export interface Anotacao {
  id: string;
  texto: string;
  criadaEm: string;
  autor: string | null;
  podeApagar: boolean;
}

/** Recados internos da equipe sobre a empresa (o cliente não vê). */
export function AnotacoesEquipe({ empresaId, anotacoes }: { empresaId: string; anotacoes: Anotacao[] }) {
  return (
    <div className="space-y-3">
      {anotacoes.length ? (
        <ul className="space-y-2">
          {anotacoes.map((a) => (
            <li key={a.id} className="flex gap-2 rounded-lg border border-border/70 bg-muted/40 p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="whitespace-pre-line text-sm text-foreground">{a.texto}</p>
                <p className="text-xs text-muted-foreground">
                  {a.autor ?? "Equipe"} · {formatarDataHora(a.criadaEm)}
                </p>
              </div>
              {a.podeApagar ? (
                <BotaoAcao
                  variante="fantasma"
                  tamanho="sm"
                  className="size-9 shrink-0 p-0"
                  aria-label="Apagar a anotação"
                  acao={() => excluirAnotacao(a.id)}
                  confirmar={{ titulo: "Apagar a anotação?", textoConfirmar: "Apagar", perigo: true }}
                >
                  <Trash2 />
                </BotaoAcao>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma anotação ainda.</p>
      )}
      <FormularioAcao acao={anotar.bind(null, empresaId)} resetarAoSucesso className="space-y-2">
        {({ estado, pendente }) => (
          <>
            <Campo rotulo="Nova anotação" htmlFor="anotacao-texto" erro={estado.erros?.texto?.[0]} ajuda="Só a equipe do escritório vê.">
              <Textarea id="anotacao-texto" name="texto" rows={3} maxLength={1000} placeholder="Ex.: o cliente prefere ser cobrado por e-mail" />
            </Campo>
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar anotação</BotaoEnviar>
            </div>
          </>
        )}
      </FormularioAcao>
    </div>
  );
}
