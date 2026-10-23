"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/form";
import { Indicador } from "@/components/ui/pagina";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatarMoeda } from "@/lib/dinheiro";
import { conferirPlanilhaProdutos, importarPlanilhaProdutos, type PreviaPlanilha } from "@/lib/gestao/acoes-importacao";
import { CAMPOS_PLANILHA, dadosDaLinha } from "@/lib/gestao/planilha-produtos";

const SITUACAO = {
  novo: { rotulo: "Novo", tom: "sucesso" },
  atualizar: { rotulo: "Atualizar", tom: "info" },
  erro: { rotulo: "Com erro", tom: "perigo" },
} as const;

/** Importação de produtos e estoque: baixa o modelo, envia a planilha, confere e grava. */
export function ImportarProdutos({ empresaId }: { empresaId: string }) {
  const router = useRouter();
  const [previa, setPrevia] = React.useState<PreviaPlanilha | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [lendo, setLendo] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  const [atualizarEstoque, setAtualizarEstoque] = React.useState(true);

  async function conferir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLendo(true);
    setErro(null);
    const r = await conferirPlanilhaProdutos(empresaId, new FormData(e.currentTarget));
    setLendo(false);
    if (r.ok && r.dados) setPrevia(r.dados);
    else {
      setPrevia(null);
      setErro(r.mensagem ?? "Não foi possível ler a planilha.");
    }
  }

  const validas = previa?.linhas.filter((l) => l.situacao !== "erro") ?? [];
  const comErro = previa?.linhas.filter((l) => l.situacao === "erro") ?? [];
  const temEstoque = previa?.colunas.includes("estoque") ?? false;

  async function importar() {
    if (!previa) return;
    setGravando(true);
    setErro(null);
    const r = await importarPlanilhaProdutos(
      empresaId,
      validas.map(dadosDaLinha),
      atualizarEstoque && temEstoque,
    );
    setGravando(false);
    if (r.ok) {
      toast.success(r.mensagem);
      router.push(`/e/${empresaId}/loja/produtos`);
      router.refresh();
    } else setErro(r.mensagem ?? "Não foi possível importar.");
  }

  const base = `/api/loja/produtos?empresa=${empresaId}`;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>1. Baixe a planilha</CardTitle>
          <CardDescription>
            Use o modelo para cadastrar produtos novos, ou baixe os produtos que já estão na loja para mudar preços e estoque de uma vez e enviar de volta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variante="contorno">
            <a href={`${base}&tipo=modelo`}>
              <Download /> Baixar modelo (Excel)
            </a>
          </Button>
          <Button asChild variante="contorno">
            <a href={`${base}&tipo=atuais`}>
              <FileSpreadsheet /> Baixar meus produtos
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Envie a planilha preenchida</CardTitle>
          <CardDescription>Excel (.xlsx) ou CSV. Antes de gravar, o portal mostra o que vai entrar, o que vai mudar e o que tem erro.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={conferir} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-medium">Planilha de produtos</span>
              <Input name="arquivo" type="file" accept=".xlsx,.csv" required onChange={() => setPrevia(null)} />
            </label>
            <Button type="submit" disabled={lendo}>
              {lendo ? <Loader2 className="animate-spin" /> : <Upload />} {lendo ? "Lendo..." : "Conferir a planilha"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}

      {previa ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Confira e importe</CardTitle>
            <CardDescription>
              Colunas reconhecidas: {CAMPOS_PLANILHA.filter((c) => previa.colunas.includes(c.chave)).map((c) => c.titulo).join(", ")}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Indicador rotulo="Produtos novos" valor={previa.linhas.filter((l) => l.situacao === "novo").length} tom="sucesso" />
              <Indicador rotulo="Produtos atualizados" valor={previa.linhas.filter((l) => l.situacao === "atualizar").length} tom="info" />
              <Indicador rotulo="Linhas com erro" valor={comErro.length} tom={comErro.length ? "perigo" : "neutro"} />
            </div>
            {temEstoque ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={atualizarEstoque} onChange={(e) => setAtualizarEstoque(e.target.checked)} className="mt-0.5" />
                <span>
                  <strong>Acertar o estoque</strong> com a coluna Estoque: o saldo de cada produto passa a ser o da planilha, e o ajuste fica no histórico do produto.
                </span>
              </label>
            ) : null}
            {comErro.length ? (
              <Alerta tom="alerta">
                {comErro.length === 1 ? "A linha com erro fica de fora." : `As ${comErro.length} linhas com erro ficam de fora.`} Corrija na planilha e envie de novo para
                incluí-las.
              </Alerta>
            ) : null}
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
              <Table>
                <THead>
                  <Tr>
                    <Th>Linha</Th>
                    <Th>Código</Th>
                    <Th>Descrição</Th>
                    <Th>Un.</Th>
                    <Th className="text-right">Preço de venda</Th>
                    <Th className="text-right">Estoque</Th>
                    <Th>Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {previa.linhas.slice(0, 300).map((l) => (
                    <Tr key={l.linha}>
                      <Td className="numero text-muted-foreground">{l.linha}</Td>
                      <Td className="numero">{l.codigo ?? <span className="text-muted-foreground">automático</span>}</Td>
                      <Td>
                        {l.descricao ?? "—"}
                        {l.erros.length ? <span className="block text-xs text-perigo">{l.erros.join("; ")}</span> : null}
                      </Td>
                      <Td>{l.unidade ?? "—"}</Td>
                      <Td className="numero text-right">{l.preco_venda ? formatarMoeda(l.preco_venda) : "—"}</Td>
                      <Td className="numero text-right">{l.estoque ? Number(l.estoque).toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "—"}</Td>
                      <Td>
                        <Badge variante={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            {previa.linhas.length > 300 ? <p className="text-xs text-muted-foreground">Mostrando 300 de {previa.linhas.length} linhas.</p> : null}
            <Button onClick={importar} disabled={gravando || !validas.length}>
              {gravando ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              {gravando ? "Importando..." : `Importar ${validas.length} produto(s)`}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
