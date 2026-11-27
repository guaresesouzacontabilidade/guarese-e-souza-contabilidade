"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { confirmarColunas } from "@/lib/maquininhas/acoes";
import { lerVendas, type MapeamentoMaquininha } from "@/lib/maquininhas/leitura";
import { CAMPOS_RELATORIO, ROTULO_MODALIDADE, type CampoRelatorio, type TipoAdquirente } from "@/lib/maquininhas/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { OpcoesAdquirente, type Adquirente } from "./contratos";

const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

/** Conferência das colunas de um relatório em formato novo (uma vez por formato). */
export function ConferirColunas({
  empresaId,
  importacaoId,
  cabecalho,
  amostra,
  inicial,
  catalogo,
  adquirenteInicial,
  nomeOutraInicial,
  equipe,
}: {
  empresaId: string;
  importacaoId: string;
  cabecalho: string[];
  amostra: string[][];
  inicial: MapeamentoMaquininha;
  catalogo: Adquirente[];
  adquirenteInicial: string;
  nomeOutraInicial: string;
  equipe: boolean;
}) {
  const acao = confirmarColunas.bind(null, empresaId, importacaoId);
  const [m, setM] = React.useState<MapeamentoMaquininha>(inicial);
  const [adquirente, setAdquirente] = React.useState(adquirenteInicial);
  const tipo: TipoAdquirente | null = adquirente === "outra" ? null : (catalogo.find((a) => a.codigo === adquirente)?.tipo ?? null);
  const colunas = Math.max(cabecalho.length, ...amostra.map((l) => l.length), 0);
  const usadas = new Set(CAMPOS_RELATORIO.map((c) => m[c.chave]).filter((v): v is number => v !== null));
  const previa = React.useMemo(() => lerVendas([cabecalho, ...amostra], { ...m, linhaCabecalho: 0 }, tipo), [cabecalho, amostra, m, tipo]);
  const nomeColuna = (i: number) => `${letra(i)} · ${cabecalho[i]?.trim() || "(sem nome)"}`;

  return (
    <FormularioAcao acao={acao} className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="linha_cabecalho" value={m.linhaCabecalho} />
          <section>
            <h2 className="mb-2 text-sm font-semibold text-titulo">Como o arquivo chegou</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-max min-w-full text-xs">
                <thead>
                  <tr className="bg-muted/60">
                    {Array.from({ length: colunas }, (_, i) => (
                      <th key={i} className={cn("border-b border-border px-2 py-1.5 text-left font-medium", usadas.has(i) && "bg-primary/10 text-primary")}>
                        <span className="text-muted-foreground">{letra(i)}</span> {cabecalho[i] ?? ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {amostra.map((l, r) => (
                    <tr key={r} className="border-b border-border last:border-0">
                      {Array.from({ length: colunas }, (_, i) => (
                        <td key={i} className={cn("max-w-48 truncate px-2 py-1", usadas.has(i) && "bg-primary/5")}>
                          {l[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Primeiras linhas do relatório. As colunas destacadas são as escolhidas abaixo.</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Adquirente do relatório" htmlFor="col-adq" erro={estado.erros?.adquirente} obrigatorio>
              <Select id="col-adq" name="adquirente" value={adquirente} onChange={(e) => setAdquirente(e.target.value)}>
                <OpcoesAdquirente catalogo={catalogo} />
              </Select>
            </Campo>
            {adquirente === "outra" ? (
              <Campo rotulo="Nome da adquirente" htmlFor="col-nome" erro={estado.erros?.adquirente_nome} obrigatorio>
                <Input id="col-nome" name="adquirente_nome" maxLength={80} defaultValue={nomeOutraInicial} />
              </Campo>
            ) : null}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-titulo">Qual coluna é cada informação</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
              {CAMPOS_RELATORIO.map((c) => (
                <Campo
                  key={c.chave}
                  rotulo={c.rotulo}
                  htmlFor={`col-${c.chave}`}
                  erro={estado.erros?.[`campo_${c.chave}`]}
                  obrigatorio={c.obrigatorio}
                  ajuda={c.ajuda || undefined}
                >
                  <Select
                    id={`col-${c.chave}`}
                    name={`campo_${c.chave}`}
                    value={m[c.chave] === null ? "" : String(m[c.chave])}
                    onChange={(e) => setM((x) => ({ ...x, [c.chave as CampoRelatorio]: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">— não tem —</option>
                    {Array.from({ length: colunas }, (_, i) => (
                      <option key={i} value={i}>
                        {nomeColuna(i)}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-titulo">Como o portal vai ler</h2>
            {previa.vendas.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Data</Th>
                    <Th>Bandeira</Th>
                    <Th>Modalidade</Th>
                    <Th className="text-right">Venda</Th>
                    <Th className="text-right">Taxa cobrada</Th>
                    <Th className="hidden sm:table-cell">Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {previa.vendas.map((v) => (
                    <Tr key={v.linha}>
                      <Td>{formatarData(v.data_venda)}</Td>
                      <Td>{v.bandeira ?? "—"}</Td>
                      <Td>
                        {ROTULO_MODALIDADE[v.modalidade]}
                        {v.modalidade === "credito_parcelado" ? ` ${v.parcelas}x` : ""}
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(v.valor_bruto)}</Td>
                      <Td className="text-right numero">
                        {formatarMoeda(v.valor_taxa)}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({((Number(v.valor_taxa) / Number(v.valor_bruto)) * 100).toFixed(2).replace(".", ",")}%)
                        </span>
                      </Td>
                      <Td className="hidden sm:table-cell">{v.situacao === "aprovada" ? "Aprovada" : "Cancelada (fica fora da conta)"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {previa.invalidas[0]
                  ? `Ainda não dá para ler as vendas: ${previa.invalidas[0].motivo.toLowerCase()}. Ajuste as colunas.`
                  : "Escolha as colunas da data, do valor da venda e do valor líquido (ou da taxa)."}
              </p>
            )}
          </section>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="lembrar" defaultChecked className="mt-0.5" />
            <span>
              Lembrar este formato{" "}
              <span className="text-muted-foreground">
                ({equipe ? "os próximos relatórios iguais, de qualquer empresa do escritório," : "os próximos relatórios iguais desta empresa"} entram sozinhos)
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Importando...">
              <CheckCircle2 /> Confirmar e importar
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
