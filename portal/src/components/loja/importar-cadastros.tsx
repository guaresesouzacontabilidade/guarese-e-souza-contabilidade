"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Loader2, RefreshCw, Upload } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Campo, Input, Select } from "@/components/ui/form";
import { Indicador } from "@/components/ui/pagina";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { conferirPlanilhaCadastros, importarLoteCadastros } from "@/lib/gestao/acoes-importar-cadastros";
import { CAMPOS_CADASTRO, paraImportarCadastros, type AnaliseCadastros, type CampoCadastro, type MapaColunas } from "@/lib/gestao/planilha-cadastros";
import { formatarDocumento, formatarTelefone } from "@/lib/formatos";

const SITUACAO = {
  novo: { rotulo: "Novo", variante: "sucesso" as const },
  existente: { rotulo: "Já cadastrado", variante: "info" as const },
  repetido: { rotulo: "Repetido", variante: "neutro" as const },
  erro: { rotulo: "Com problema", variante: "perigo" as const },
};
const LOTE = 300;
const MOSTRAR = 300;

/** Importar clientes ou fornecedores de outro sistema: modelo, conferência das colunas, prévia e gravação em lotes. */
export function ImportarCadastros({ empresaId, papel }: { empresaId: string; papel: "cliente" | "fornecedor" }) {
  const router = useRouter();
  const arquivoRef = React.useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [ddd, setDdd] = React.useState("");
  const [mapa, setMapa] = React.useState<MapaColunas>({});
  const [previa, setPrevia] = React.useState<AnaliseCadastros | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [lendo, setLendo] = React.useState(false);
  const [progresso, setProgresso] = React.useState<string | null>(null);
  const [feito, setFeito] = React.useState<{ novos: number; atualizados: number } | null>(null);
  const [filtro, setFiltro] = React.useState<"todas" | "novo" | "existente" | "repetido" | "erro" | "avisos">("todas");
  const lista = `/e/${empresaId}/loja/${papel === "cliente" ? "clientes" : "fornecedores"}`;
  const plural = papel === "cliente" ? "clientes" : "fornecedores";

  async function conferir(novoMapa = mapa, novoArquivo = arquivo) {
    if (!novoArquivo) {
      setErro("Escolha a planilha (Excel .xlsx ou .csv).");
      return;
    }
    setLendo(true);
    setErro(null);
    setFeito(null);
    const fd = new FormData();
    fd.set("arquivo", novoArquivo);
    fd.set("ddd", ddd);
    fd.set("mapa", JSON.stringify(novoMapa));
    const r = await conferirPlanilhaCadastros(empresaId, papel, fd);
    setLendo(false);
    if (r.ok && r.dados) setPrevia(r.dados);
    else {
      setPrevia(null);
      setErro(r.mensagem ?? "Não foi possível ler a planilha.");
    }
  }

  function trocarColuna(titulo: string, valor: string) {
    const novo = { ...mapa, [titulo]: valor as CampoCadastro | "ignorar" };
    setMapa(novo);
    void conferir(novo);
  }

  async function importar() {
    if (!previa) return;
    const linhas = paraImportarCadastros(previa.linhas);
    if (!linhas.length) return;
    setErro(null);
    let novos = 0;
    let atualizados = 0;
    for (let i = 0; i < linhas.length; i += LOTE) {
      setProgresso(`Gravando ${Math.min(i + LOTE, linhas.length)} de ${linhas.length}...`);
      const r = await importarLoteCadastros(empresaId, papel, linhas.slice(i, i + LOTE));
      if (!r.ok || !r.dados) {
        setProgresso(null);
        setErro(`${r.mensagem ?? "Não foi possível gravar."} ${i > 0 ? `Os primeiros ${i} já foram gravados; envie a planilha de novo para continuar (não duplica).` : ""}`);
        return;
      }
      novos += r.dados.novos;
      atualizados += r.dados.atualizados;
    }
    setProgresso(null);
    setFeito({ novos, atualizados });
    setPrevia(null);
    setArquivo(null);
    setMapa({});
    if (arquivoRef.current) arquivoRef.current.value = "";
    router.refresh();
  }

  const linhasFiltradas = previa
    ? previa.linhas.filter((l) => (filtro === "todas" ? true : filtro === "avisos" ? l.avisos.length > 0 : l.situacao === filtro))
    : [];
  const aImportar = previa ? previa.totais.novo + previa.totais.existente : 0;
  const comAvisos = previa ? previa.linhas.filter((l) => l.avisos.length > 0).length : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Escolha a planilha</CardTitle>
          <CardDescription>
            Exporte a lista de {plural} do sistema antigo (no GestãoClick: tela de {papel === "cliente" ? "Clientes" : "Fornecedores"} → exportar para Excel) e envie aqui
            como está, ou preencha o modelo. Excel (.xlsx) ou CSV. O arquivo é lido no servidor do portal e não fica guardado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variante="contorno">
            <a href={`/api/loja/cadastros/modelo?empresa=${empresaId}&papel=${papel}`}>
              <Download /> Baixar modelo (Excel)
            </a>
          </Button>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end [&>*]:min-w-0">
            <Campo rotulo="Planilha" htmlFor="imp-arquivo">
              <Input
                ref={arquivoRef}
                id="imp-arquivo"
                type="file"
                accept=".xlsx,.csv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setArquivo(f);
                  setMapa({});
                  setPrevia(null);
                  setFeito(null);
                }}
              />
            </Campo>
            <Campo rotulo="DDD padrão" htmlFor="imp-ddd" ajuda="Para telefones sem DDD.">
              <Input id="imp-ddd" inputMode="numeric" maxLength={2} placeholder="63" value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ""))} />
            </Campo>
            <Button onClick={() => void conferir()} disabled={!arquivo || lendo} className="mb-0.5">
              {lendo ? <Loader2 className="animate-spin" /> : <Upload />} Conferir planilha
            </Button>
          </div>
          {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
          {feito ? (
            <Alerta tom="sucesso">
              Importação concluída: {feito.novos} cadastro(s) novo(s) e {feito.atualizados} completado(s).{" "}
              <Link href={lista} className="font-medium underline">
                Ver {plural}
              </Link>
            </Alerta>
          ) : null}
        </CardContent>
      </Card>

      {previa ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Confira as colunas</CardTitle>
              <CardDescription>
                Aba “{previa.aba}”, títulos na linha {previa.linhaTitulos}. Se alguma coluna foi entendida errado, troque aqui (a prévia é refeita na hora).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {previa.colunas
                  .filter((c) => c.titulo)
                  .map((c) => (
                    <label key={c.titulo} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="w-36 shrink-0 truncate font-medium" title={c.titulo}>
                        {c.titulo}
                      </span>
                      <Select
                        aria-label={`O que é a coluna ${c.titulo}`}
                        value={c.campo ?? "ignorar"}
                        onChange={(e) => trocarColuna(c.titulo, e.target.value)}
                        disabled={lendo}
                        className="min-w-0 flex-1"
                      >
                        <option value="ignorar">Não importar</option>
                        {CAMPOS_CADASTRO.filter((f) => papel === "fornecedor" || f.chave !== "prazo").map((f) => (
                          <option key={f.chave} value={f.chave}>
                            {f.titulo}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Prévia</CardTitle>
              <CardDescription>Nada foi gravado ainda. Quem já está cadastrado só completa o que estiver vazio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="totais-importacao">
                <Indicador rotulo="Novos" valor={String(previa.totais.novo)} tom="sucesso" />
                <Indicador rotulo="Já cadastrados" valor={String(previa.totais.existente)} detalhe="Completa o vazio" />
                <Indicador rotulo="Repetidos na planilha" valor={String(previa.totais.repetido)} />
                <Indicador rotulo="Com problema" valor={String(previa.totais.erro)} tom={previa.totais.erro ? "perigo" : "neutro"} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="w-full sm:w-64">
                  <option value="todas">Todas as linhas ({previa.linhas.length})</option>
                  <option value="novo">Novos ({previa.totais.novo})</option>
                  <option value="existente">Já cadastrados ({previa.totais.existente})</option>
                  <option value="avisos">Com aviso ({comAvisos})</option>
                  <option value="repetido">Repetidos ({previa.totais.repetido})</option>
                  <option value="erro">Com problema ({previa.totais.erro})</option>
                </Select>
                <Button variante="fantasma" onClick={() => void conferir()} disabled={lendo}>
                  <RefreshCw /> Conferir de novo
                </Button>
              </div>
              <Table>
                <THead>
                  <Tr>
                    <Th>Linha</Th>
                    <Th>Nome</Th>
                    <Th>CPF/CNPJ</Th>
                    <Th>Telefone</Th>
                    <Th>Cidade</Th>
                    <Th>Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {linhasFiltradas.slice(0, MOSTRAR).map((l) => (
                    <Tr key={l.linha} data-testid="linha-previa">
                      <Td>{l.linha}</Td>
                      <Td>
                        <span className="font-medium">{l.nome || "—"}</span>
                        {!l.ativo ? <span className="ml-1 text-xs text-muted-foreground">(inativo)</span> : null}
                        {l.motivo ? <p className="text-xs text-muted-foreground">{l.motivo}</p> : null}
                        {l.avisos.length ? <p className="text-xs text-alerta">{l.avisos.join("; ")}</p> : null}
                      </Td>
                      <Td className="whitespace-nowrap">{l.documento ? formatarDocumento(l.documento) : "—"}</Td>
                      <Td className="whitespace-nowrap">{l.telefone ? formatarTelefone(l.telefone) : "—"}</Td>
                      <Td>{l.cidade ? `${l.cidade}${l.uf ? ` / ${l.uf}` : ""}` : "—"}</Td>
                      <Td>
                        <Badge variante={SITUACAO[l.situacao].variante}>{SITUACAO[l.situacao].rotulo}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              {linhasFiltradas.length > MOSTRAR ? (
                <p className="text-xs text-muted-foreground">Mostrando {MOSTRAR} de {linhasFiltradas.length} linhas. Todas entram na importação.</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {progresso ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> {progresso}
                  </span>
                ) : null}
                <Button onClick={() => void importar()} disabled={!aImportar || Boolean(progresso) || lendo}>
                  Importar {aImportar} {aImportar === 1 ? "cadastro" : "cadastros"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
