"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Indicador } from "@/components/ui/pagina";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatarCpf, formatarTelefone } from "@/lib/formatos";
import { conferirPlanilhaTutores, importarLoteTutores } from "@/lib/veterinaria/acoes-importacao";
import {
  CAMPOS_ANIMAL,
  CAMPOS_TUTOR,
  animalEntra,
  nomeProprio,
  paraImportar,
  type CampoImportacao,
  type EscolhasImportacao,
  type ResultadoAnalise,
} from "@/lib/veterinaria/planilha-tutores";
import { ESPECIES } from "@/lib/veterinaria/rotulos";

const LOTE = 300;
const TIPO_ABA = { animais: "tutores e animais", tutores: "só tutores", ignorada: "não usada" } as const;

type Totais = { tutores_novos: number; tutores_existentes: number; animais_novos: number; animais_existentes: number };

/** Importação de tutores e animais: modelo, envio da planilha do sistema antigo, prévia (com a correção das colunas) e gravação em lotes. */
export function ImportarTutores({ empresaId, dddPadrao }: { empresaId: string; dddPadrao: string }) {
  const router = useRouter();
  const [arquivos, setArquivos] = React.useState<File[]>([]);
  const [ddd, setDdd] = React.useState(dddPadrao);
  const [mapa, setMapa] = React.useState<Record<string, CampoImportacao | "ignorar">>({});
  const [previa, setPrevia] = React.useState<ResultadoAnalise | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [lendo, setLendo] = React.useState(false);
  const [progresso, setProgresso] = React.useState<{ feito: number; total: number } | null>(null);
  const [resultado, setResultado] = React.useState<Totais | null>(null);
  const [escolhas, setEscolhas] = React.useState<EscolhasImportacao>({ especiePadrao: "", corrigirMaiusculas: true });

  async function conferir(novoMapa = mapa) {
    if (!arquivos.length) {
      setErro("Escolha a planilha (Excel .xlsx ou .csv).");
      return;
    }
    setLendo(true);
    setErro(null);
    setResultado(null);
    const fd = new FormData();
    for (const a of arquivos) fd.append("arquivo", a);
    fd.set("ddd", ddd);
    fd.set("mapa", JSON.stringify(novoMapa));
    const r = await conferirPlanilhaTutores(empresaId, fd);
    setLendo(false);
    if (r.ok && r.dados) setPrevia(r.dados);
    else {
      setPrevia(null);
      setErro(r.mensagem ?? "Não foi possível ler a planilha.");
    }
  }

  function corrigirColuna(abaId: string, indice: number, campo: string) {
    const novo = { ...mapa, [`${abaId}|${indice}`]: (campo || "ignorar") as CampoImportacao | "ignorar" };
    setMapa(novo);
    void conferir(novo);
  }

  const envio = React.useMemo(() => (previa ? paraImportar(previa.tutores, escolhas) : []), [previa, escolhas]);
  const tutoresNovos = previa?.tutores.filter((t) => !t.erros.length && t.nome && !t.existente).length ?? 0;
  const animaisNovos = envio.reduce((s, t) => s + t.animais.length, 0);
  const animaisExistentes = previa?.tutores.reduce((s, t) => s + t.animais.filter((a) => a.existente).length, 0) ?? 0;
  const semEspecie = previa?.tutores.reduce((s, t) => s + t.animais.filter((a) => !a.existente && !a.especie).length, 0) ?? 0;
  const tutoresComErro = previa?.tutores.filter((t) => t.erros.length) ?? [];
  const erros = [...(previa?.linhasComErro ?? []), ...tutoresComErro.map((t) => ({ origem: t.origem, erros: t.erros }))];
  const avisos = (previa?.tutores ?? []).flatMap((t) => [
    ...t.avisos.map((a) => ({ origem: t.origem, texto: `${t.nome ?? "tutor"}: ${a}` })),
    ...t.animais.flatMap((an) => an.avisos.map((a) => ({ origem: an.origem, texto: `${an.nome}: ${a}` }))),
  ]);

  async function importar() {
    if (!envio.length) return;
    setErro(null);
    const totais: Totais = { tutores_novos: 0, tutores_existentes: 0, animais_novos: 0, animais_existentes: 0 };
    setProgresso({ feito: 0, total: envio.length });
    for (let i = 0; i < envio.length; i += LOTE) {
      const r = await importarLoteTutores(empresaId, envio.slice(i, i + LOTE));
      if (!r.ok || !r.dados) {
        setProgresso(null);
        setErro(
          `${r.mensagem ?? "Não foi possível importar."}${i > 0 ? ` Os primeiros ${i} tutores já foram gravados; corrija a planilha e envie de novo (o que já entrou não é duplicado).` : ""}`,
        );
        return;
      }
      for (const k of Object.keys(totais) as (keyof Totais)[]) totais[k] += r.dados[k];
      setProgresso({ feito: Math.min(i + LOTE, envio.length), total: envio.length });
    }
    setProgresso(null);
    setResultado(totais);
    setPrevia(null);
    toast.success(`Importação concluída: ${totais.tutores_novos} tutor(es) e ${totais.animais_novos} animal(is) novos.`);
    router.refresh();
  }

  const nome = (n: string) => (escolhas.corrigirMaiusculas ? nomeProprio(n) : n);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>1. A planilha</CardTitle>
          <CardDescription>
            Envie a planilha do sistema antigo como ela está: o portal reconhece as colunas pelo título (Tutor, Cliente, Proprietário, CPF, Telefone, Animal, Espécie,
            Raça...). Se preferir, preencha o modelo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variante="contorno">
            <a href={`/api/veterinaria/${empresaId}/modelo-importacao`}>
              <Download /> Baixar modelo (Excel)
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Envie a planilha</CardTitle>
          <CardDescription>
            Excel (.xlsx) ou CSV, até 2 MB. Tutores e animais em abas ou arquivos separados também valem (ligados pelo código do cliente). Nada é gravado antes da sua
            conferência.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setMapa({});
              void conferir({});
            }}
            className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
          >
            <Campo rotulo="Planilha(s)" htmlFor="imp-arquivo">
              <Input
                id="imp-arquivo"
                type="file"
                accept=".xlsx,.csv"
                multiple
                onChange={(e) => {
                  setArquivos(Array.from(e.target.files ?? []));
                  setPrevia(null);
                  setResultado(null);
                }}
              />
            </Campo>
            <Campo rotulo="DDD" htmlFor="imp-ddd" ajuda="Para telefone sem DDD.">
              <Input id="imp-ddd" inputMode="numeric" maxLength={2} value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ""))} />
            </Campo>
            <Button type="submit" disabled={lendo || !arquivos.length}>
              {lendo ? <Loader2 className="animate-spin" /> : <Upload />} {lendo ? "Lendo..." : "Conferir a planilha"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}

      {resultado ? (
        <Alerta tom="sucesso" titulo="Importação concluída">
          <p>
            {resultado.tutores_novos} tutor(es) novo(s) e {resultado.animais_novos} animal(is) novo(s) cadastrados.
            {resultado.tutores_existentes ? ` ${resultado.tutores_existentes} tutor(es) já estavam no portal.` : ""}
            {resultado.animais_existentes ? ` ${resultado.animais_existentes} animal(is) já estavam cadastrados e ficaram como estavam.` : ""}
          </p>
          <Link href={`/e/${empresaId}/veterinaria/pacientes`} className="mt-1 inline-flex items-center gap-1 font-medium underline">
            <CheckCircle2 className="size-4" /> Ver tutores e animais
          </Link>
        </Alerta>
      ) : null}

      {previa ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Confira e importe</CardTitle>
            <CardDescription>Confira as colunas reconhecidas e a lista. Tutor e animal que já estão no portal não são duplicados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              {previa.abas.map((aba) => (
                <details key={aba.id} className="rounded-lg border border-border p-3" open={aba.tipo === "ignorada" && previa.abas.length === 1}>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{previa.abas.length === 1 ? aba.arquivo : `${aba.arquivo} › ${aba.aba}`}</span>
                    {": "}
                    {aba.tipo === "ignorada" ? (
                      <span className="text-alerta">não usada ({aba.motivo})</span>
                    ) : (
                      <>
                        {aba.linhas} linha(s), {TIPO_ABA[aba.tipo]}. <span className="text-muted-foreground">Ver ou corrigir as colunas</span>
                      </>
                    )}
                  </summary>
                  {aba.colunas.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {aba.colunas
                        .filter((c) => c.titulo)
                        .map((c) => (
                          <label key={c.indice} className="flex min-w-0 flex-col gap-1 text-xs">
                            <span className="truncate font-medium" title={c.titulo}>
                              {c.titulo}
                            </span>
                            <Select
                              aria-label={`O que é a coluna ${c.titulo}`}
                              value={c.campo === "animal_codigo" ? "" : (c.campo ?? "")}
                              disabled={lendo}
                              onChange={(e) => corrigirColuna(aba.id, c.indice, e.target.value)}
                            >
                              <option value="">Não importar</option>
                              <optgroup label="Tutor">
                                {CAMPOS_TUTOR.map((f) => (
                                  <option key={f.chave} value={f.chave}>
                                    {f.titulo}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Animal">
                                {CAMPOS_ANIMAL.map((f) => (
                                  <option key={f.chave} value={f.chave}>
                                    {f.titulo}
                                  </option>
                                ))}
                              </optgroup>
                            </Select>
                          </label>
                        ))}
                    </div>
                  ) : null}
                </details>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador rotulo="Tutores novos" valor={tutoresNovos} tom="sucesso" />
              <Indicador rotulo="Animais novos" valor={animaisNovos} tom="sucesso" />
              <Indicador
                rotulo="Já estavam no portal"
                valor={`${previa.tutores.filter((t) => t.existente).length} tutor(es)`}
                detalhe={`${animaisExistentes} animal(is) ficam como estão`}
                tom="info"
              />
              <Indicador rotulo="Linhas com erro" valor={erros.length} tom={erros.length ? "perigo" : "neutro"} detalhe="ficam de fora" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Espécie dos animais sem espécie na planilha"
                htmlFor="imp-especie"
                ajuda={semEspecie ? `${semEspecie} animal(is) sem espécie.` : "Todos os animais têm espécie."}
              >
                <Select id="imp-especie" value={escolhas.especiePadrao} onChange={(e) => setEscolhas({ ...escolhas, especiePadrao: e.target.value })}>
                  <option value="">Deixar esses animais de fora</option>
                  <option value="canina">Cão</option>
                  <option value="felina">Gato</option>
                  <option value="outra">Outra (não informada)</option>
                </Select>
              </Campo>
              <label className="flex items-start gap-2 self-center text-sm">
                <Checkbox checked={escolhas.corrigirMaiusculas} onChange={(e) => setEscolhas({ ...escolhas, corrigirMaiusculas: e.target.checked })} className="mt-0.5" />
                <span>
                  Corrigir nomes em MAIÚSCULAS
                  <span className="block text-xs text-muted-foreground">MARIA DA SILVA vira Maria da Silva (nos lembretes sai &quot;Olá, Maria!&quot;).</span>
                </span>
              </label>
            </div>

            {erros.length ? (
              <details className="rounded-lg border border-perigo/40 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-perigo">{erros.length} linha(s) com erro ficam de fora — ver quais</summary>
                <ul className="mt-2 space-y-1">
                  {erros.slice(0, 200).map((e, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{e.origem}:</span> {e.erros.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {avisos.length ? (
              <details className="rounded-lg border border-alerta/40 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-alerta">{avisos.length} aviso(s): entram, mas um dado ficou de fora ou foi ajustado — ver</summary>
                <ul className="mt-2 space-y-1">
                  {avisos.slice(0, 300).map((a, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{a.origem}:</span> {a.texto}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="max-h-[32rem] overflow-auto rounded-xl border border-border">
              <Table>
                <THead>
                  <Tr>
                    <Th>Tutor</Th>
                    <Th>Contato</Th>
                    <Th>Animais</Th>
                  </Tr>
                </THead>
                <TBody>
                  {previa.tutores.slice(0, 300).map((t, i) => (
                    <Tr key={i}>
                      <Td>
                        <span className="font-medium">{t.nome ? nome(t.nome) : "—"}</span>{" "}
                        {t.erros.length ? <Badge variante="perigo">Com erro</Badge> : t.existente ? <Badge variante="info">Já cadastrado</Badge> : <Badge variante="sucesso">Novo</Badge>}
                        {t.cpf ? <span className="block text-xs text-muted-foreground">CPF {formatarCpf(t.cpf)}</span> : null}
                        <span className="block text-xs text-muted-foreground">{t.origem}</span>
                      </Td>
                      <Td className="text-xs">
                        {[t.telefone, t.telefone2].filter(Boolean).map((x) => formatarTelefone(x!)).join(" / ") || "—"}
                        {t.cidade ? <span className="block text-muted-foreground">{[t.cidade, t.uf].filter(Boolean).join("/")}</span> : null}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {t.animais.length
                            ? t.animais.map((a, j) => {
                                const entra = animalEntra(a, escolhas) && !t.erros.length;
                                return (
                                  <Badge key={j} variante={a.existente ? "neutro" : entra ? "sucesso" : "alerta"} title={a.existente ? "Já cadastrado" : entra ? "Novo" : "Fica de fora"}>
                                    {nome(a.nome)} · {a.especie ? ESPECIES[a.especie] : escolhas.especiePadrao ? ESPECIES[escolhas.especiePadrao] : "sem espécie"}
                                    {a.ativo ? "" : " · inativo"}
                                    {a.existente ? " · já cadastrado" : ""}
                                  </Badge>
                                );
                              })
                            : <span className="text-xs text-muted-foreground">Sem animais</span>}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            {previa.tutores.length > 300 ? <p className="text-xs text-muted-foreground">Mostrando 300 de {previa.tutores.length} tutores (todos entram na importação).</p> : null}

            {progresso ? (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progresso.feito / progresso.total) * 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Gravando... {progresso.feito} de {progresso.total} tutores.
                </p>
              </div>
            ) : null}
            <Button onClick={importar} disabled={Boolean(progresso) || lendo || !envio.length}>
              {progresso ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              {progresso ? "Importando..." : `Importar ${tutoresNovos} tutor(es) novo(s) e ${animaisNovos} animal(is)`}
            </Button>
            {!envio.length ? <p className="text-sm text-muted-foreground">Nada novo para importar: tudo já está no portal ou ficou de fora.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
