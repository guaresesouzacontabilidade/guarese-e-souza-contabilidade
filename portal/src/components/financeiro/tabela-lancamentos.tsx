"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { ORIGEM_LANCAMENTO, SITUACAO_LANCAMENTO } from "@/lib/rotulos";
import { confirmarLancamentos } from "@/lib/financeiro/acoes-lancamentos";

export interface LinhaLancamento {
  id: string;
  tipo: string;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  competencia: string;
  vencimento: string;
  valor: string;
  aberto: string;
  situacao: string;
  atrasado: boolean;
  revisao: string;
  origem: string;
  parcela: string | null;
}

export function TabelaLancamentos({
  empresaId,
  linhas,
  podeEditar,
  categorias,
}: {
  empresaId: string;
  linhas: LinhaLancamento[];
  podeEditar: boolean;
  categorias: { id: string; nome: string; natureza: string }[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [categoria, setCategoria] = useState("");
  const [pendente, iniciar] = useTransition();
  const sugeridos = linhas.filter((l) => l.revisao === "sugerido");
  const selecionadosSugeridos = sugeridos.filter((l) => sel.has(l.id));
  const tipos = new Set(selecionadosSugeridos.map((l) => l.tipo));
  const natureza = tipos.size === 1 ? ([...tipos][0] === "receber" ? "receita" : "despesa") : null;

  function confirmar() {
    iniciar(async () => {
      const r = await confirmarLancamentos(empresaId, selecionadosSugeridos.map((l) => l.id), categoria || undefined);
      if (r.ok) {
        toast.success(r.mensagem ?? "Confirmado.");
        setSel(new Set());
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível confirmar.");
    });
  }

  return (
    <div className="space-y-3">
      {podeEditar && selecionadosSugeridos.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          <span className="px-1 text-sm font-medium">{selecionadosSugeridos.length} sugerido(s) selecionado(s)</span>
          {natureza ? (
            <Select aria-label="Categoria a aplicar" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-8 w-72 text-xs">
              <option value="">Manter a categoria sugerida</option>
              {categorias
                .filter((c) => c.natureza === natureza)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">Selecione apenas receitas ou apenas despesas para definir a categoria.</span>
          )}
          <Button tamanho="sm" variante="sucesso" onClick={confirmar} disabled={pendente}>
            {pendente ? <Loader2 className="animate-spin" /> : <CheckCheck />} Confirmar
          </Button>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            {podeEditar && sugeridos.length ? (
              <Th className="w-8">
                <Checkbox
                  aria-label="Selecionar sugeridos"
                  checked={sugeridos.length > 0 && sugeridos.every((l) => sel.has(l.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(sugeridos.map((l) => l.id)) : new Set())}
                />
              </Th>
            ) : null}
            <Th>Vencimento</Th>
            <Th>Descrição</Th>
            <Th>Categoria</Th>
            <Th className="text-right">Valor</Th>
            <Th className="text-right">Em aberto</Th>
            <Th>Situação</Th>
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => {
            const st = l.atrasado ? SITUACAO_LANCAMENTO.atrasado : SITUACAO_LANCAMENTO[l.situacao];
            return (
              <Tr key={l.id}>
                {podeEditar && sugeridos.length ? (
                  <Td>
                    {l.revisao === "sugerido" ? (
                      <Checkbox
                        aria-label={`Selecionar ${l.descricao}`}
                        checked={sel.has(l.id)}
                        onChange={() =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (n.has(l.id)) n.delete(l.id);
                            else n.add(l.id);
                            return n;
                          })
                        }
                      />
                    ) : null}
                  </Td>
                ) : null}
                <Td className="whitespace-nowrap text-sm">
                  {formatarData(l.vencimento)}
                  <span className="block text-xs text-muted-foreground">comp. {formatarData(l.competencia).slice(3)}</span>
                </Td>
                <Td className="max-w-[18rem]">
                  <Link href={`/e/${empresaId}/financeiro/lancamentos/${l.id}`} className="block truncate font-medium hover:underline" title={l.descricao}>
                    {l.descricao}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[l.contraparte, l.origem !== "manual" ? ORIGEM_LANCAMENTO[l.origem] ?? l.origem : null].filter(Boolean).join(" · ") || "—"}
                  </span>
                </Td>
                <Td className="max-w-[11rem] truncate text-sm" title={l.categoria ?? undefined}>
                  {l.categoria ?? <span className="text-alerta-fg">Sem categoria</span>}
                </Td>
                <Td className={l.tipo === "receber" ? "whitespace-nowrap text-right text-sucesso numero" : "whitespace-nowrap text-right text-perigo numero"}>
                  {l.tipo === "receber" ? "+" : "−"} {formatarMoeda(l.valor)}
                </Td>
                <Td className="whitespace-nowrap text-right numero">{l.situacao === "cancelado" ? "—" : formatarMoeda(l.aberto)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {l.revisao === "sugerido" ? <Badge variante="alerta">Sugerido</Badge> : null}
                    <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? l.situacao}</Badge>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
