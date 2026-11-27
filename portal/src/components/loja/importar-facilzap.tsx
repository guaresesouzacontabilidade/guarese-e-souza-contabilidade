"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Pause, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { analisarFacilZap, importarLoteFacilZap, type AnaliseFacilZap, type ResultadoItemFz } from "@/lib/vitrine/acoes-importacao";

const LOTE = 8;

/** Traz os produtos da loja na FácilZap para o portal: cadastro, estoque, textos, categorias e fotos. */
export function ImportarFacilZap({ empresaId, enderecoInicial }: { empresaId: string; enderecoInicial: string }) {
  const [endereco, setEndereco] = React.useState(enderecoInicial);
  const [analise, setAnalise] = React.useState<AnaliseFacilZap | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [analisando, iniciarAnalise] = React.useTransition();
  const [ncm, setNcm] = React.useState<Record<string, string>>({});
  const [comFotos, setComFotos] = React.useState(true);
  const [quais, setQuais] = React.useState<"novos" | "todos">("novos");
  const [rodando, setRodando] = React.useState(false);
  const [feitos, setFeitos] = React.useState(0);
  const [resultados, setResultados] = React.useState<ResultadoItemFz[]>([]);
  const parar = React.useRef(false);
  const router = useRouter();

  const fila = analise ? analise.itens.filter((i) => quais === "todos" || !i.importado) : [];
  const erros = resultados.filter((r) => !r.ok);
  const okNovos = resultados.filter((r) => r.ok && r.novo).length;
  const okAtualizados = resultados.filter((r) => r.ok && !r.novo).length;
  const fotos = resultados.reduce((s, r) => s + (r.ok && r.fotos ? r.fotos : 0), 0);

  const analisar = () =>
    iniciarAnalise(async () => {
      setErro(null);
      setResultados([]);
      setFeitos(0);
      const r = await analisarFacilZap(empresaId, endereco);
      if (!r.ok || !r.dados) {
        setAnalise(null);
        setErro(r.mensagem ?? "Não foi possível ler a loja.");
        return;
      }
      setAnalise(r.dados);
      setNcm(Object.fromEntries(r.dados.principais.map((c) => [c.nome, c.sugestao])));
      setQuais(r.dados.itens.some((i) => !i.importado) ? "novos" : "todos");
    });

  const rodar = async (inicio: number) => {
    if (!analise) return;
    parar.current = false;
    setRodando(true);
    for (let i = inicio; i < fila.length; i += LOTE) {
      if (parar.current) break;
      const lote = fila.slice(i, i + LOTE);
      const r = await importarLoteFacilZap(
        empresaId,
        analise.base,
        lote.map(({ id, categoria, subcategoria, posicao }) => ({ id, categoria, subcategoria, posicao })),
        ncm,
        { fotos: comFotos },
      );
      const itens = r.ok && r.dados ? r.dados.itens : lote.map((x) => ({ id: x.id, nome: x.nome, ok: false, erro: r.mensagem ?? "Falha no lote." }));
      setResultados((ant) => [...ant, ...itens]);
      setFeitos(Math.min(i + LOTE, fila.length));
    }
    setRodando(false);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Endereço da loja na FácilZap" htmlFor="fz-endereco" className="min-w-72 flex-1" ajuda="O portal lê o catálogo público que a FácilZap publica (catalogo.md). Nada é gravado antes da sua confirmação.">
          <Input id="fz-endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="https://shopluanaaraujo.com.br" inputMode="url" disabled={rodando} />
        </Campo>
        <Button type="button" onClick={analisar} disabled={analisando || rodando || !endereco.trim()}>
          {analisando ? <Loader2 className="animate-spin" /> : <Search />} {analisando ? "Lendo a loja…" : "Ler a loja"}
        </Button>
      </div>
      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}

      {analise ? (
        <>
          <Alerta tom="info" titulo={`${analise.loja ?? "Loja"}: ${analise.itens.length} produtos em ${analise.principais.length} categorias`}>
            {analise.itens.filter((i) => i.importado).length
              ? `${analise.itens.filter((i) => i.importado).length} já foram importados antes. Importar de novo atualiza preço, estoque, textos e categoria com o que está na FácilZap agora (o NCM e as fotos escolhidas no portal ficam).`
              : "Cada produto entra no cadastro da loja (código, preço, estoque e NCM) e no site (nome, descrição, opções, categoria e até 5 fotos)."}
          </Alerta>

          <div>
            <h3 className="text-sm font-semibold">NCM de cada categoria</h3>
            <p className="mb-2 text-xs text-muted-foreground">A FácilZap não tem NCM; o portal precisa dele para a nota fiscal. Vale para os produtos novos; depois dá para ajustar um a um em Produtos e estoque. As sugestões são só um ponto de partida: confira.</p>
            <Table>
              <THead>
                <tr>
                  <Th>Categoria na FácilZap</Th>
                  <Th className="text-right">Produtos</Th>
                  <Th>NCM</Th>
                </tr>
              </THead>
              <TBody>
                {analise.principais.map((c) => (
                  <Tr key={c.nome}>
                    <Td className="font-medium">{c.nome}</Td>
                    <Td className="text-right numero">{c.total}</Td>
                    <Td>
                      <Input
                        value={ncm[c.nome] ?? ""}
                        onChange={(e) => setNcm((n) => ({ ...n, [c.nome]: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                        inputMode="numeric"
                        placeholder="8 números"
                        aria-label={`NCM de ${c.nome}`}
                        className="w-36"
                        disabled={rodando}
                        aria-invalid={Boolean(ncm[c.nome]) && !/^\d{8}$/.test(ncm[c.nome])}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Select value={quais} onChange={(e) => setQuais(e.target.value as typeof quais)} aria-label="Quais produtos" className="w-72" disabled={rodando}>
              <option value="novos">Só os que ainda não vieram ({analise.itens.filter((i) => !i.importado).length})</option>
              <option value="todos">Todos ({analise.itens.length}), atualizando os já importados</option>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={comFotos} onChange={(e) => setComFotos(e.target.checked)} disabled={rodando} /> Trazer as fotos (até 5 por produto)
            </label>
          </div>

          {fila.length ? (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div role="progressbar" aria-valuemin={0} aria-valuemax={fila.length} aria-valuenow={feitos} aria-label={`${feitos} de ${fila.length} produtos`} className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${fila.length ? (feitos / fila.length) * 100 : 0}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">
                {okNovos} novo(s) · {okAtualizados} atualizado(s) · {fotos} foto(s) · {erros.length} com problema
              </p>
              <div className="flex flex-wrap gap-2">
                {!rodando && feitos === 0 ? (
                  <Button type="button" onClick={() => void rodar(0)}>
                    <Download /> Importar {fila.length} produto(s)
                  </Button>
                ) : null}
                {rodando ? (
                  <Button type="button" variante="contorno" onClick={() => (parar.current = true)}>
                    <Pause /> Pausar
                  </Button>
                ) : null}
                {!rodando && feitos > 0 && feitos < fila.length ? (
                  <Button type="button" onClick={() => void rodar(feitos)}>
                    <Play /> Continuar
                  </Button>
                ) : null}
                {rodando ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Importando… pode levar alguns minutos. Deixe esta página aberta.
                  </span>
                ) : null}
              </div>
              {!rodando && feitos === fila.length && feitos > 0 ? <Alerta tom={erros.length ? "alerta" : "sucesso"}>Importação concluída. Confira os produtos em “Produtos no site”.</Alerta> : null}
            </div>
          ) : (
            <Alerta tom="sucesso">Todos os produtos já foram importados. Para atualizar preços e estoque com a FácilZap, escolha “Todos”.</Alerta>
          )}

          {erros.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Produtos com problema ({erros.length})</h3>
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {erros.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.nome}</span> <span className="text-muted-foreground">— {r.erro}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Corrija (ex.: o NCM da categoria) e rode de novo com “Só os que ainda não vieram”.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
