"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, GitCompareArrows, Loader2, MoreHorizontal, Sparkles, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Campo, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { ignorarMovimentos } from "@/lib/conciliacao/acoes";
import { ConciliarManual, ValorSinal } from "./conciliar-manual";
import { ClassificarMovimento, type OpcoesClassificacao } from "./classificar";

export interface MovimentoPendente {
  id: string;
  data: string;
  valor: string;
  descricao: string;
  conta_id: string;
  conta_nome: string;
  documento: string | null;
  em_sugestao: boolean;
}

const MOTIVOS_RAPIDOS = [
  "Aplicação ou resgate automático",
  "Estorno feito pelo próprio banco",
  "Movimentação de outra empresa ou pessoa física",
  "Duplicada no extrato",
];

export function TabelaPendentes({
  empresaId,
  linhas,
  podeExecutar,
  podeClassificar,
  opcoes,
}: {
  empresaId: string;
  linhas: MovimentoPendente[];
  podeExecutar: boolean;
  podeClassificar: boolean;
  opcoes: OpcoesClassificacao;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [conciliar, setConciliar] = useState<string[] | null>(null);
  const [classificar, setClassificar] = useState<MovimentoPendente | null>(null);
  const [ignorar, setIgnorar] = useState<string[] | null>(null);

  const selecionados = linhas.filter((l) => sel.has(l.id));
  const contas = new Set(selecionados.map((l) => l.conta_id));
  const sinais = new Set(selecionados.map((l) => dec(l.valor).greaterThan(0)));
  const parTransferencia =
    selecionados.length === 2 && contas.size === 2 && dec(selecionados[0].valor).plus(dec(selecionados[1].valor)).isZero();
  const selecaoValida = selecionados.length > 0 && ((contas.size === 1 && sinais.size === 1) || parTransferencia);
  const total = somar(selecionados.map((l) => l.valor));

  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      {podeExecutar && selecionados.length ? (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          <span className="px-1 text-sm font-medium">
            {selecionados.length} selecionada(s) · <span className="numero">{formatarMoeda(total, { sinal: true })}</span>
          </span>
          <Button tamanho="sm" onClick={() => setConciliar(selecionados.map((l) => l.id))} disabled={!selecaoValida}>
            <GitCompareArrows /> {parTransferencia ? "Conciliar como transferência" : "Conciliar juntas"}
          </Button>
          <Button tamanho="sm" variante="contorno" onClick={() => setIgnorar(selecionados.map((l) => l.id))}>
            <EyeOff /> Ignorar
          </Button>
          <Button tamanho="sm" variante="fantasma" onClick={() => setSel(new Set())}>
            Limpar seleção
          </Button>
          {!selecaoValida ? (
            <p className="w-full px-1 text-xs text-muted-foreground">
              Para conciliar juntas, selecione movimentações da mesma conta e do mesmo sentido — ou uma saída e uma entrada de mesmo valor em contas
              diferentes (transferência).
            </p>
          ) : null}
        </div>
      ) : null}

      <Table>
        <THead>
          <tr>
            {podeExecutar ? (
              <Th className="w-8">
                <Checkbox
                  aria-label="Selecionar todas"
                  checked={linhas.length > 0 && linhas.every((l) => sel.has(l.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map((l) => l.id)) : new Set())}
                />
              </Th>
            ) : null}
            <Th>Data</Th>
            <Th>Descrição no extrato</Th>
            <Th className="text-right">Valor</Th>
            {podeExecutar ? <Th className="text-right">Ações</Th> : null}
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => (
            <Tr key={l.id} className={sel.has(l.id) ? "bg-bege/40" : undefined}>
              {podeExecutar ? (
                <Td>
                  <Checkbox aria-label={`Selecionar ${l.descricao}`} checked={sel.has(l.id)} onChange={() => alternar(l.id)} />
                </Td>
              ) : null}
              <Td className="whitespace-nowrap text-sm">{formatarData(l.data)}</Td>
              <Td className="max-w-[22rem]">
                <p className="truncate font-medium" title={l.descricao}>
                  {l.descricao}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{l.conta_nome}</span>
                  {l.documento ? <span>· {formatarDocumento(l.documento)}</span> : null}
                  {l.em_sugestao ? (
                    <Badge variante="info">
                      <Sparkles /> há sugestão
                    </Badge>
                  ) : null}
                </p>
              </Td>
              <Td className="text-right">
                <ValorSinal valor={l.valor} />
              </Td>
              {podeExecutar ? (
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button tamanho="sm" variante="contorno" onClick={() => setConciliar([l.id])}>
                      Conciliar
                    </Button>
                    <Menu>
                      <MenuGatilho asChild>
                        <Button tamanho="iconeSm" variante="fantasma" aria-label={`Mais ações para ${l.descricao}`}>
                          <MoreHorizontal />
                        </Button>
                      </MenuGatilho>
                      <MenuConteudo>
                        {podeClassificar ? (
                          <MenuItem onSelect={() => setClassificar(l)}>
                            <Tags /> Classificar (criar lançamento)
                          </MenuItem>
                        ) : null}
                        <MenuItem onSelect={() => setIgnorar([l.id])}>
                          <EyeOff /> Ignorar
                        </MenuItem>
                      </MenuConteudo>
                    </Menu>
                  </div>
                </Td>
              ) : null}
            </Tr>
          ))}
        </TBody>
      </Table>

      {conciliar ? (
        <ConciliarManual
          empresaId={empresaId}
          movimentoIds={conciliar}
          aberto
          aoMudar={(v) => !v && setConciliar(null)}
          aoConcluir={() => setSel(new Set())}
        />
      ) : null}
      {classificar ? (
        <ClassificarMovimento empresaId={empresaId} movimento={classificar} opcoes={opcoes} aoFechar={() => setClassificar(null)} />
      ) : null}
      {ignorar ? (
        <IgnorarMovimentos
          empresaId={empresaId}
          ids={ignorar}
          aoFechar={(ok) => {
            setIgnorar(null);
            if (ok) setSel(new Set());
          }}
        />
      ) : null}
    </div>
  );
}

function IgnorarMovimentos({ empresaId, ids, aoFechar }: { empresaId: string; ids: string[]; aoFechar: (ok: boolean) => void }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const enviar = () =>
    iniciar(async () => {
      const r = await ignorarMovimentos(empresaId, ids, motivo);
      if (r.ok) {
        toast.success(r.mensagem ?? "Ignorada.");
        aoFechar(true);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível ignorar.");
    });
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar(false)}>
      <DialogContent
        titulo={ids.length > 1 ? `Ignorar ${ids.length} movimentações` : "Ignorar movimentação"}
        descricao="Movimentações ignoradas não entram na conciliação nem nos alertas. Você pode reativá-las depois."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_RAPIDOS.map((m) => (
              <Button key={m} type="button" tamanho="sm" variante="contorno" onClick={() => setMotivo(m)}>
                {m}
              </Button>
            ))}
          </div>
          <Campo rotulo="Motivo" htmlFor="motivo-ignorar" obrigatorio>
            <Textarea id="motivo-ignorar" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
          </Campo>
          <div className="flex justify-end gap-2">
            <Button variante="contorno" onClick={() => aoFechar(false)}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={pendente || motivo.trim().length < 3}>
              {pendente ? <Loader2 className="animate-spin" /> : null} Ignorar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
