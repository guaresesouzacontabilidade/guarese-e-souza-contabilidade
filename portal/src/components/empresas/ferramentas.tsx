"use client";

import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Checkbox } from "@/components/ui/form";
import type { ResultadoAcao } from "@/lib/acoes";
import { FERRAMENTAS } from "@/lib/empresas/ferramentas";

/** Cadastro da empresa → Ferramentas: o escritório liga e desliga cada função do portal para a empresa. */
export function FerramentasEmpresa({
  acao,
  desligadas,
  podeEditar,
}: {
  acao: (anterior: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;
  desligadas: string[];
  podeEditar: boolean;
}) {
  const grupos = [...new Set(FERRAMENTAS.map((f) => f.grupo))].map((g) => [g, FERRAMENTAS.filter((f) => f.grupo === g)] as const);
  return (
    <FormularioAcao acao={acao} className="space-y-5">
      {({ pendente }) => (
        <>
          <p className="text-sm text-muted-foreground">
            Deixe marcado só o que esta empresa usa. A ferramenta desmarcada some do menu, do painel e das telas da empresa — para o cliente e para a equipe. Nada é
            apagado: os dados e as configurações continuam guardados e voltam quando a ferramenta for ligada de novo.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {grupos.map(([grupo, itens]) => (
              <fieldset key={grupo} className="rounded-2xl border border-border p-4">
                <legend className="px-1 text-sm font-semibold text-titulo">{grupo}</legend>
                <div className="space-y-1">
                  {itens.map((f) => (
                    <label key={f.chave} className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted">
                      <Checkbox name="ligadas" value={f.chave} defaultChecked={!desligadas.includes(f.chave)} disabled={!podeEditar} className="mt-0.5" />
                      <span className="text-sm">
                        <span className="font-medium">{f.rotulo}</span>
                        {"descricao" in f ? <span className="block text-xs text-muted-foreground">{f.descricao}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sempre ligados: início, documentos, pendências, mensagens e configurações. A loja (vender, caixa e estoque) e as ordens de carregamento são ligadas em
            Gestão da loja.
          </p>
          {podeEditar ? <BotaoEnviar pendente={pendente}>Salvar ferramentas</BotaoEnviar> : null}
        </>
      )}
    </FormularioAcao>
  );
}
