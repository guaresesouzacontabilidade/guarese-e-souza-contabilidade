"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatarMoeda } from "@/lib/dinheiro";
import { importarNotaEstoque, type ProdutoImportado, type ResultadoImportacao } from "@/lib/gestao/acoes-importar-nota";

const MODO: Record<ProdutoImportado["modo"], { rotulo: string; variante: "sucesso" | "info" | "primario" }> = {
  vinculo: { rotulo: "Já ligado", variante: "primario" },
  gtin: { rotulo: "Código de barras", variante: "info" },
  descricao: { rotulo: "Mesmo nome", variante: "info" },
  novo: { rotulo: "Produto novo", variante: "sucesso" },
};

interface Envio {
  nome: string;
  situacao: "esperando" | "lendo" | "lancada" | "aviso" | "erro";
  mensagem?: string;
  resultado?: ResultadoImportacao;
}

const quantidade = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(n);

/**
 * Importar nota de compra: escolhe um ou mais arquivos (XML ou PDF), o portal
 * lê cada nota e lança todos os itens no estoque. Mostra, por nota, para qual
 * produto foi cada item (e os produtos novos com o preço de venda).
 */
export function ImportarNota({ empresaId, margemInicial }: { empresaId: string; margemInicial: string }) {
  const router = useRouter();
  const entrada = React.useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = React.useState<File[]>([]);
  const [margem, setMargem] = React.useState(margemInicial);
  const [envios, setEnvios] = React.useState<Envio[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const base = `/e/${empresaId}/loja/produtos`;

  async function importar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!arquivos.length) return;
    setEnviando(true);
    const lista: Envio[] = arquivos.map((a) => ({ nome: a.name, situacao: "esperando" }));
    setEnvios([...lista]);
    for (let i = 0; i < arquivos.length; i++) {
      lista[i] = { ...lista[i], situacao: "lendo" };
      setEnvios([...lista]);
      const fd = new FormData();
      fd.set("arquivo", arquivos[i]);
      fd.set("margem", margem);
      let r: Awaited<ReturnType<typeof importarNotaEstoque>>;
      try {
        r = await importarNotaEstoque(empresaId, fd);
      } catch {
        r = { ok: false, mensagem: "Não foi possível enviar o arquivo (conexão ou arquivo grande demais). Tente de novo." };
      }
      const d = r.dados;
      lista[i] = {
        nome: lista[i].nome,
        situacao: !r.ok ? "erro" : d?.situacao === "lancada" ? "lancada" : "aviso",
        mensagem: r.mensagem,
        resultado: d,
      };
      setEnvios([...lista]);
    }
    setEnviando(false);
    setArquivos([]);
    if (entrada.current) entrada.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={importar} className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-medium">Arquivo da nota (XML ou PDF)</span>
            <Input
              ref={entrada}
              type="file"
              multiple
              accept=".xml,.pdf,application/pdf,text/xml,application/xml"
              onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Margem dos produtos novos</span>
            <span className="relative block w-full sm:w-36">
              <Input
                name="margem"
                inputMode="decimal"
                required
                value={margem}
                onChange={(e) => setMargem(e.target.value.replace(/[^\d.,]/g, ""))}
                className="pr-8 text-right"
                aria-describedby="ajuda-margem"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </span>
          </label>
          <Button type="submit" disabled={enviando || !arquivos.length}>
            {enviando ? <Loader2 className="animate-spin" /> : <Upload />} {enviando ? "Lendo as notas..." : "Ler e lançar no estoque"}
          </Button>
        </div>
        <p id="ajuda-margem" className="text-xs text-muted-foreground">
          Item que ainda não existe na loja vira produto novo com o preço de venda = custo da nota + esta margem (dá para mudar depois no cadastro do produto).
        </p>
      </form>

      {envios.length ? (
        <ul className="space-y-3" aria-live="polite">
          {envios.map((env, i) => (
            <li key={`${env.nome}-${i}`}>
              <ResultadoEnvio envio={env} base={base} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ResultadoEnvio({ envio, base }: { envio: Envio; base: string }) {
  const r = envio.resultado;
  if (envio.situacao === "esperando" || envio.situacao === "lendo") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
        {envio.situacao === "lendo" ? <Loader2 className="size-4 animate-spin" /> : null}
        <span className="min-w-0 truncate">{envio.nome}</span>
        <span className="ml-auto shrink-0">{envio.situacao === "lendo" ? "lendo..." : "na fila"}</span>
      </div>
    );
  }
  if (envio.situacao === "erro") {
    return (
      <Alerta tom="perigo" titulo={envio.nome}>
        {envio.mensagem}
      </Alerta>
    );
  }
  if (envio.situacao === "aviso") {
    return (
      <Alerta
        tom="alerta"
        titulo={envio.nome}
        acao={
          r?.situacao === "conferir" && r.documento_fiscal_id ? (
            <Button asChild tamanho="sm" variante="contorno">
              <Link href={`${base}/entrada-nota?nota=${r.documento_fiscal_id}`}>Conferir item a item</Link>
            </Button>
          ) : null
        }
      >
        <p>{envio.mensagem}</p>
        {r?.motivos?.length ? (
          <ul className="mt-1 list-disc pl-5">
            {r.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </Alerta>
    );
  }
  const novos = r?.produtos?.filter((p) => p.modo === "novo") ?? [];
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <Alerta tom="sucesso" titulo={envio.nome}>
        {envio.mensagem}
        {novos.length ? " Confira o preço de venda dos produtos novos." : null}
      </Alerta>
      {r?.produtos?.length ? (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                <Th>Item da nota</Th>
                <Th>Produto da loja</Th>
                <Th className="text-right">Entrou</Th>
                <Th className="text-right">Custo</Th>
                <Th className="text-right">Preço de venda</Th>
              </tr>
            </THead>
            <TBody>
              {r.produtos.map((p, k) => (
                <Tr key={`${p.produto_id}-${k}`}>
                  <Td className="text-xs text-muted-foreground">{p.item}</Td>
                  <Td>
                    <Link href={`${base}/${p.produto_id}`} className="font-medium text-primary hover:underline">
                      {p.produto}
                    </Link>
                    <span className="mt-0.5 block">
                      <Badge variante={MODO[p.modo].variante}>{MODO[p.modo].rotulo}</Badge>
                      {!p.controla_estoque ? <span className="ml-1 text-xs text-muted-foreground">(não controla estoque)</span> : null}
                    </span>
                  </Td>
                  <Td className="text-right numero whitespace-nowrap">
                    {quantidade(p.quantidade)} {p.unidade}
                  </Td>
                  <Td className="text-right numero">{formatarMoeda(p.custo)}</Td>
                  <Td className="text-right numero">{formatarMoeda(p.preco_venda)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
