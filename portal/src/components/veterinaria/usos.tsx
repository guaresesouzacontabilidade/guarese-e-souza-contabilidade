"use client";

import * as React from "react";
import { PackageMinus } from "lucide-react";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";
import { registrarUso } from "@/lib/veterinaria/acoes";

export interface ProdutoUso {
  id: string;
  descricao: string;
  unidade: string;
  valor_unitario: number | string | null;
  estoque_atual: number | string;
  controla_estoque: boolean;
}

/** Quantidade digitada ("2,5" ou "2.5") como número; inválida = null. */
function numero(v: string): number | null {
  const t = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  return /^\d{1,6}(\.\d{1,4})?$/.test(t) ? Number(t) : null;
}

/**
 * Baixa no estoque do que foi usado no atendimento (em fração, na unidade do
 * produto: ex. 2,5 mL de um frasco de 50 mL) e, se marcar, cobrança na conta
 * do tutor (quantidade × preço de venda, ou o valor informado).
 */
export function FormularioUso({ empresaId, atendimentoId, produtos }: { empresaId: string; atendimentoId: string; produtos: ProdutoUso[] }) {
  const [produtoId, setProdutoId] = React.useState(produtos[0]?.id ?? "");
  const [quantidade, setQuantidade] = React.useState("");
  const [cobrar, setCobrar] = React.useState(false);
  const p = produtos.find((x) => x.id === produtoId) ?? null;
  const q = numero(quantidade.trim());
  const sugerido = p && q !== null && p.valor_unitario != null ? Math.round(q * Number(p.valor_unitario) * 100) / 100 : null;

  if (!produtos.length) {
    return <p className="text-sm text-muted-foreground">Cadastre os medicamentos e materiais em Pet shop e farmácia → Produtos e estoque (ex.: unidade Mililitro para remédio fracionado).</p>;
  }
  return (
    <FormularioAcao acao={registrarUso.bind(null, empresaId, atendimentoId)} resetarAoSucesso aoSucesso={() => setQuantidade("")} className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Produto" htmlFor="us-produto" erro={estado.erros?.produto_id}>
            <Select id="us-produto" name="produto_id" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              {produtos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.descricao}
                  {x.controla_estoque ? ` — estoque ${formatarQuantidade(x.estoque_atual)} ${un(x.unidade)}` : ""}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo={`Quantidade usada${p ? ` (${un(p.unidade)})` : ""}`} htmlFor="us-qtd" erro={estado.erros?.quantidade} ajuda="Pode ser fração: 2,5">
              <Input id="us-qtd" name="quantidade" inputMode="decimal" maxLength={12} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0" />
            </Campo>
            {cobrar ? (
              <Campo
                rotulo="Valor a cobrar"
                htmlFor="us-valor"
                erro={estado.erros?.valor}
                ajuda={sugerido !== null ? `Vazio = ${formatarMoeda(sugerido)} (quantidade × preço de venda).` : "Vazio = quantidade × preço de venda."}
              >
                <Input id="us-valor" name="valor" inputMode="decimal" maxLength={14} placeholder="0,00" />
              </Campo>
            ) : null}
          </div>
          {p && p.controla_estoque && q !== null && q > Number(p.estoque_atual) ? (
            <p className="text-xs text-alerta">O estoque registrado não cobre esta quantidade: a baixa entra mesmo assim e o estoque fica negativo para conferir.</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="cobrar" checked={cobrar} onChange={(e) => setCobrar(e.target.checked)} /> Cobrar na conta do tutor
            </label>
            <BotaoEnviar pendente={pendente} textoPendente="Lançando...">
              <PackageMinus /> Dar baixa
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
