"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, GitCompareArrows, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import type { Mapeamento } from "@/lib/extratos/planilha";
import type { MapeamentoLancamentos, PreviaExtrato, LinhaLancamentoImportada } from "@/lib/financeiro/importacao";
import { confirmarImportacaoExtrato, confirmarImportacaoLancamentos, previaExtrato, previaLancamentos } from "@/lib/financeiro/acoes-importacao";
import { telaPronta } from "@/components/layout/navegacao";

interface Props {
  empresaId: string;
  documento: { id: string; nome: string };
  tipoArquivo: "ofx" | "planilha";
  contas: { id: string; nome: string; tipo: string }[];
  contaSugerida: string | null;
  ofx: { conta: string | null; banco: string | null; cartao: boolean; inicio: string | null; fim: string | null } | null;
  amostra: string[][];
  mapeamento: Mapeamento | null;
  mapeamentoLanc: MapeamentoLancamentos | null;
  previaInicial: PreviaExtrato | null;
}

const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

function SeletorColuna({ rotulo, valor, colunas, aoMudar, obrigatorio }: { rotulo: string; valor: number | null; colunas: string[]; aoMudar: (v: number | null) => void; obrigatorio?: boolean }) {
  return (
    <Campo rotulo={rotulo} obrigatorio={obrigatorio}>
      <Select value={valor ?? ""} onChange={(e) => aoMudar(e.target.value === "" ? null : Number(e.target.value))} className="h-9">
        <option value="">—</option>
        {colunas.map((c, i) => (
          <option key={i} value={i}>
            Coluna {letra(i)}
            {c ? `: ${c.slice(0, 30)}` : ""}
          </option>
        ))}
      </Select>
    </Campo>
  );
}

export function AssistenteImportacao(p: Props) {
  const router = useRouter();
  const [modo, setModo] = useState<"extrato" | "lancamentos">("extrato");
  const [conta, setConta] = useState(p.contaSugerida ?? "");
  const [contaPagamentos, setContaPagamentos] = useState("");
  const [m, setM] = useState<Mapeamento | null>(p.mapeamento);
  const [ml, setMl] = useState<MapeamentoLancamentos | null>(p.mapeamentoLanc);
  const [previa, setPrevia] = useState<PreviaExtrato | null>(p.previaInicial);
  const [previaL, setPreviaL] = useState<{ total: number; invalidas: { linha: number; motivo: string; conteudo?: string }[]; amostra: LinhaLancamentoImportada[]; receber: number; pagar: number; semCategoria: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, iniciarPrevia] = useTransition();
  const [importando, iniciarImportacao] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);
  const primeira = useRef(true);

  const colunas = useMemo(() => {
    const cab = m && m.linhaCabecalho >= 0 ? p.amostra[m.linhaCabecalho] ?? [] : [];
    const n = Math.max(0, ...p.amostra.map((l) => l.length));
    return Array.from({ length: n }, (_, i) => cab[i] ?? "");
  }, [p.amostra, m]);

  // Atualiza a prévia quando o mapeamento ou a conta mudam
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      if (p.previaInicial) return;
    }
    const t = setTimeout(() => {
      iniciarPrevia(async () => {
        setErro(null);
        if (modo === "extrato") {
          const r = await previaExtrato(p.empresaId, p.documento.id, conta || null, m);
          if (r.ok && r.dados) setPrevia(r.dados);
          else setErro(r.mensagem ?? "Não foi possível gerar a prévia.");
        } else {
          const r = await previaLancamentos(p.empresaId, p.documento.id, ml);
          if (r.ok && r.dados) setPreviaL(r.dados);
          else setErro(r.mensagem ?? "Não foi possível gerar a prévia.");
        }
      });
    }, 350);
    return () => clearTimeout(t);
  }, [m, ml, conta, modo, p.empresaId, p.documento.id, p.previaInicial]);

  function importar() {
    iniciarImportacao(async () => {
      if (modo === "extrato") {
        if (!conta) {
          toast.error("Escolha a conta do extrato.");
          return;
        }
        const r = await confirmarImportacaoExtrato(p.empresaId, p.documento.id, conta, m);
        if (r.ok && r.dados) {
          setResultado(
            `${r.mensagem} ${r.dados.duplicadas ? `${r.dados.duplicadas} já existia(m) e foi(ram) ignorada(s). ` : ""}${r.dados.periodoFechado ? `${r.dados.periodoFechado} em competência fechada não foram importadas. ` : ""}${r.dados.invalidas ? `${r.dados.invalidas} linha(s) inválida(s).` : ""}`,
          );
          router.refresh();
        } else toast.error(r.mensagem ?? "Falha na importação.");
      } else {
        const r = await confirmarImportacaoLancamentos(p.empresaId, p.documento.id, ml, contaPagamentos || null);
        if (r.ok && r.dados) {
          setResultado(`${r.mensagem} ${r.dados.duplicadas ? `${r.dados.duplicadas} linha(s) já importada(s) antes foram ignoradas.` : ""}`);
          router.refresh();
        } else toast.error(r.mensagem ?? "Falha na importação.");
      }
    });
  }

  if (resultado) {
    return (
      <Alerta
        tom="sucesso"
        titulo="Importação concluída"
        acao={
          modo === "extrato" && telaPronta(`/e/${p.empresaId}/conciliacao`) ? (
            <Button asChild tamanho="sm">
              <Link href={`/e/${p.empresaId}/conciliacao`}>
                <GitCompareArrows /> Conciliar
              </Link>
            </Button>
          ) : (
            <Button asChild tamanho="sm">
              <Link href={`/e/${p.empresaId}/financeiro/lancamentos?revisao=sugerido`}>Revisar sugeridos</Link>
            </Button>
          )
        }
      >
        {resultado} {modo === "extrato" ? "As movimentações aguardam conciliação; nenhuma receita ou despesa foi criada automaticamente." : ""}
      </Alerta>
    );
  }

  const contasExtrato = p.contas.filter((c) => c.tipo !== "adquirente" || true);
  const pronto = modo === "extrato" ? Boolean(conta && previa && previa.novas > 0) : Boolean(previaL && previaL.total > 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" /> {p.documento.nome}
          </CardTitle>
          <CardDescription>
            {p.tipoArquivo === "ofx"
              ? `Extrato OFX${p.ofx?.cartao ? " de cartão" : ""} · conta ${p.ofx?.conta ?? "não informada"} · ${formatarData(p.ofx?.inicio)} a ${formatarData(p.ofx?.fim)}`
              : "Planilha: confira as colunas abaixo antes de importar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.tipoArquivo === "planilha" ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={modo === "extrato"} onChange={() => setModo("extrato")} className="accent-[var(--primary)]" /> Extrato bancário (movimentações da conta)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={modo === "lancamentos"} onChange={() => setModo("lancamentos")} className="accent-[var(--primary)]" /> Contas a pagar/receber (lançamentos)
              </label>
            </div>
          ) : null}

          {modo === "extrato" ? (
            <Campo rotulo="Conta do extrato" obrigatorio ajuda={p.contaSugerida ? "Sugerida pelo número da conta no arquivo — confira." : "Escolha a conta a que o extrato pertence."}>
              <Select value={conta} onChange={(e) => setConta(e.target.value)} className="sm:w-96">
                <option value="">Selecione...</option>
                {contasExtrato.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : (
            <Campo rotulo="Conta dos pagamentos já realizados (opcional)" ajuda="Linhas com data de pagamento só viram baixas se você informar a conta e a categoria for reconhecida.">
              <Select value={contaPagamentos} onChange={(e) => setContaPagamentos(e.target.value)} className="sm:w-96">
                <option value="">Não registrar pagamentos</option>
                {p.contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          )}

          {p.tipoArquivo === "planilha" ? (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/70">
                    <tr>
                      <th className="px-2 py-1 text-left font-semibold">Linha</th>
                      {colunas.map((_, i) => (
                        <th key={i} className="px-2 py-1 text-left font-semibold">
                          {letra(i)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {p.amostra.slice(0, 12).map((l, i) => (
                      <tr key={i} className={m?.linhaCabecalho === i || ml?.linhaCabecalho === i ? "bg-bege/60 font-semibold" : undefined}>
                        <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                        {colunas.map((_, c) => (
                          <td key={c} className="max-w-[12rem] truncate px-2 py-1">
                            {l[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {modo === "extrato" && m ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Campo rotulo="Linha do cabeçalho">
                    <Select value={m.linhaCabecalho} onChange={(e) => setM({ ...m, linhaCabecalho: Number(e.target.value) })} className="h-9">
                      <option value={-1}>Sem cabeçalho</option>
                      {p.amostra.slice(0, 30).map((_, i) => (
                        <option key={i} value={i}>
                          Linha {i + 1}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <SeletorColuna rotulo="Data" obrigatorio valor={m.data} colunas={colunas} aoMudar={(v) => setM({ ...m, data: v })} />
                  <SeletorColuna rotulo="Descrição / histórico" valor={m.descricao} colunas={colunas} aoMudar={(v) => setM({ ...m, descricao: v })} />
                  <SeletorColuna rotulo="Complemento" valor={m.complemento} colunas={colunas} aoMudar={(v) => setM({ ...m, complemento: v })} />
                  <SeletorColuna rotulo="Valor (com sinal ou D/C)" valor={m.valor} colunas={colunas} aoMudar={(v) => setM({ ...m, valor: v })} />
                  <SeletorColuna rotulo="Débito (coluna separada)" valor={m.debito} colunas={colunas} aoMudar={(v) => setM({ ...m, debito: v })} />
                  <SeletorColuna rotulo="Crédito (coluna separada)" valor={m.credito} colunas={colunas} aoMudar={(v) => setM({ ...m, credito: v })} />
                  <SeletorColuna rotulo="Tipo (D/C)" valor={m.tipo} colunas={colunas} aoMudar={(v) => setM({ ...m, tipo: v })} />
                  <SeletorColuna rotulo="Documento / nº" valor={m.documento} colunas={colunas} aoMudar={(v) => setM({ ...m, documento: v })} />
                  <SeletorColuna rotulo="Saldo" valor={m.saldo} colunas={colunas} aoMudar={(v) => setM({ ...m, saldo: v })} />
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <Checkbox checked={m.inverterSinal} onChange={(e) => setM({ ...m, inverterSinal: e.target.checked })} /> Inverter sinais (saídas positivas no arquivo)
                  </label>
                </div>
              ) : null}
              {modo === "lancamentos" && ml ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Campo rotulo="Linha do cabeçalho">
                    <Select value={ml.linhaCabecalho} onChange={(e) => setMl({ ...ml, linhaCabecalho: Number(e.target.value) })} className="h-9">
                      <option value={-1}>Sem cabeçalho</option>
                      {p.amostra.slice(0, 30).map((_, i) => (
                        <option key={i} value={i}>
                          Linha {i + 1}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Tipo">
                    <Select value={ml.tipoFixo ?? ""} onChange={(e) => setMl({ ...ml, tipoFixo: (e.target.value || null) as MapeamentoLancamentos["tipoFixo"] })} className="h-9">
                      <option value="">Pela coluna (ou sinal do valor)</option>
                      <option value="receber">Todas a receber</option>
                      <option value="pagar">Todas a pagar</option>
                    </Select>
                  </Campo>
                  {!ml.tipoFixo ? <SeletorColuna rotulo="Coluna do tipo" valor={ml.tipo} colunas={colunas} aoMudar={(v) => setMl({ ...ml, tipo: v })} /> : null}
                  <SeletorColuna rotulo="Descrição" valor={ml.descricao} colunas={colunas} aoMudar={(v) => setMl({ ...ml, descricao: v })} />
                  <SeletorColuna rotulo="Competência / emissão" valor={ml.data_competencia} colunas={colunas} aoMudar={(v) => setMl({ ...ml, data_competencia: v })} />
                  <SeletorColuna rotulo="Vencimento" valor={ml.data_vencimento} colunas={colunas} aoMudar={(v) => setMl({ ...ml, data_vencimento: v })} />
                  <SeletorColuna rotulo="Valor" obrigatorio valor={ml.valor} colunas={colunas} aoMudar={(v) => setMl({ ...ml, valor: v })} />
                  <SeletorColuna rotulo="Categoria (código ou nome)" valor={ml.categoria} colunas={colunas} aoMudar={(v) => setMl({ ...ml, categoria: v })} />
                  <SeletorColuna rotulo="Cliente/fornecedor" valor={ml.contraparte_nome} colunas={colunas} aoMudar={(v) => setMl({ ...ml, contraparte_nome: v })} />
                  <SeletorColuna rotulo="CPF/CNPJ" valor={ml.contraparte_documento} colunas={colunas} aoMudar={(v) => setMl({ ...ml, contraparte_documento: v })} />
                  <SeletorColuna rotulo="Nº do documento" valor={ml.numero_documento} colunas={colunas} aoMudar={(v) => setMl({ ...ml, numero_documento: v })} />
                  <SeletorColuna rotulo="Data do pagamento" valor={ml.data_pagamento} colunas={colunas} aoMudar={(v) => setMl({ ...ml, data_pagamento: v })} />
                  <SeletorColuna rotulo="Valor pago" valor={ml.valor_pago} colunas={colunas} aoMudar={(v) => setMl({ ...ml, valor_pago: v })} />
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Prévia</CardTitle>
            <CardDescription>Nada é gravado até você confirmar. Linhas já importadas antes são reconhecidas e não se repetem.</CardDescription>
          </div>
          {carregando ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {modo === "extrato" && previa ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-5">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Movimentações</p>
                  <p className="font-semibold numero">{previa.total}</p>
                </div>
                <div className="rounded-lg bg-sucesso-bg p-3 text-sucesso-fg">
                  <p className="text-xs">Novas</p>
                  <p className="font-semibold numero">{conta ? previa.novas : "—"}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Já importadas</p>
                  <p className="font-semibold numero">{conta ? previa.duplicadas : "—"}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Créditos / débitos</p>
                  <p className="font-semibold numero">
                    {formatarMoeda(previa.creditos)} / {formatarMoeda(previa.debitos)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Período</p>
                  <p className="font-semibold">
                    {formatarData(previa.inicio)} a {formatarData(previa.fim)}
                  </p>
                </div>
              </div>
              {previa.saldoFinal ? (
                <p className="text-sm text-muted-foreground">
                  Saldo informado no arquivo: <strong className="numero">{formatarMoeda(previa.saldoFinal.valor)}</strong>
                  {previa.saldoFinal.data ? ` em ${formatarData(previa.saldoFinal.data)}` : ""} (usado na conferência de saldos).
                </p>
              ) : null}
              {previa.invalidas.length ? (
                <Alerta tom="alerta" titulo={`${previa.invalidas.length} linha(s) não puderam ser lidas e não serão importadas`}>
                  <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
                    {previa.invalidas.slice(0, 30).map((i) => (
                      <li key={i.linha}>
                        Linha {i.linha}: {i.motivo}
                      </li>
                    ))}
                  </ul>
                </Alerta>
              ) : null}
              {previa.amostra.length ? (
                <Table>
                  <THead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Descrição</Th>
                      <Th className="text-right">Valor</Th>
                      <Th>Situação</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {previa.amostra.slice(0, 50).map((t, i) => (
                      <Tr key={i} className={t.duplicada ? "opacity-60" : undefined}>
                        <Td className="whitespace-nowrap text-sm">{formatarData(t.data)}</Td>
                        <Td className="max-w-[28rem] truncate text-sm">{t.descricao}</Td>
                        <Td className={t.valor.startsWith("-") ? "whitespace-nowrap text-right text-perigo numero" : "whitespace-nowrap text-right text-sucesso numero"}>{formatarMoeda(t.valor)}</Td>
                        <Td>{t.duplicada ? <Badge variante="neutro">Já importada</Badge> : <Badge variante="sucesso">Nova</Badge>}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma movimentação reconhecida. Ajuste as colunas de data e valor.</p>
              )}
              {previa.total > 50 ? <p className="text-xs text-muted-foreground">Mostrando 50 de {previa.total}.</p> : null}
            </>
          ) : null}

          {modo === "lancamentos" && previaL ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Linhas válidas</p>
                  <p className="font-semibold numero">{previaL.total}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">A receber / a pagar</p>
                  <p className="font-semibold numero">
                    {previaL.receber} / {previaL.pagar}
                  </p>
                </div>
                <div className="rounded-lg bg-alerta-bg p-3 text-alerta-fg">
                  <p className="text-xs">Sem categoria reconhecida</p>
                  <p className="font-semibold numero">{previaL.semCategoria}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Inválidas</p>
                  <p className="font-semibold numero">{previaL.invalidas.length}</p>
                </div>
              </div>
              {previaL.semCategoria ? (
                <p className="flex gap-1.5 text-sm text-alerta-fg">
                  <AlertTriangle className="size-4 shrink-0" /> Linhas sem categoria reconhecida entram como “sugeridas” e só valem nos relatórios depois de revisadas.
                </p>
              ) : null}
              {previaL.invalidas.length ? (
                <Alerta tom="alerta" titulo="Linhas que não serão importadas">
                  <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
                    {previaL.invalidas.slice(0, 30).map((i) => (
                      <li key={i.linha}>
                        Linha {i.linha}: {i.motivo}
                      </li>
                    ))}
                  </ul>
                </Alerta>
              ) : null}
              <Table>
                <THead>
                  <tr>
                    <Th>Tipo</Th>
                    <Th>Descrição</Th>
                    <Th>Competência</Th>
                    <Th>Vencimento</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>Categoria</Th>
                  </tr>
                </THead>
                <TBody>
                  {previaL.amostra.slice(0, 50).map((l) => (
                    <Tr key={l.linha}>
                      <Td className="text-sm">{l.tipo === "receber" ? "Receber" : "Pagar"}</Td>
                      <Td className="max-w-[20rem] truncate text-sm">{l.descricao}</Td>
                      <Td className="text-sm">{formatarData(l.data_competencia)}</Td>
                      <Td className="text-sm">{formatarData(l.data_vencimento)}</Td>
                      <Td className="text-right numero">{formatarMoeda(l.valor)}</Td>
                      <Td className="text-sm">{l.categoria_codigo ?? "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {!pronto && modo === "extrato" && conta && previa && previa.novas === 0 && previa.total > 0 ? (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-sucesso" /> Todas as movimentações deste arquivo já foram importadas nesta conta.
              </span>
            ) : null}
            <Button tamanho="lg" onClick={importar} disabled={!pronto || importando || carregando}>
              {importando ? <Loader2 className="animate-spin" /> : <Upload />}
              {modo === "extrato" ? `Importar ${previa && conta ? previa.novas : ""} movimentação(ões)` : `Importar ${previaL?.total ?? ""} lançamento(s)`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
