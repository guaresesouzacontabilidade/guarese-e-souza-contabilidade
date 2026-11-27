"use client";

import * as React from "react";
import { FileDown, FileSpreadsheet, FileText, Send } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Textarea } from "@/components/ui/form";
import { publicarRelatorioCorrecoes } from "@/lib/auditor-fiscal/acoes";
import { ROTULO_REGRA, SITUACAO_ACHADO, TIPO_ACHADO } from "@/lib/auditor-fiscal/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia } from "@/lib/formatos";

export interface AchadoParaRelatorio {
  id: string;
  regra: string;
  titulo: string;
  competencia: string;
  tipo: string;
  situacao: string;
  valor_estimado: number | string | null;
}

/**
 * Relatório de correções para o cliente: a equipe escolhe os achados, escreve
 * um recado e baixa o PDF (explicação, como corrigir, produtos e notas) e a
 * planilha de produtos — ou publica os dois em Documentos da empresa.
 */
export function RelatorioCorrecoes({ empresaId, achados, podePublicar }: { empresaId: string; achados: AchadoParaRelatorio[]; podePublicar: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  // Por padrão, os achados já revisados (confirmados ou publicados)
  const [marcados, setMarcados] = React.useState<Set<string>>(() => new Set(achados.filter((a) => ["confirmado", "publicado"].includes(a.situacao)).map((a) => a.id)));
  const [recado, setRecado] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);

  const escolhidos = achados.filter((a) => marcados.has(a.id));
  const economia = escolhidos.filter((a) => a.tipo === "oportunidade").reduce((t, a) => t + Number(a.valor_estimado ?? 0), 0);
  const novos = escolhidos.filter((a) => a.situacao === "novo").length;
  const link = (formato: "pdf" | "xlsx") => {
    const p = new URLSearchParams({ ids: escolhidos.map((a) => a.id).join(","), formato });
    if (recado.trim()) p.set("recado", recado.trim());
    return `/api/auditor/${empresaId}/relatorio?${p.toString()}`;
  };
  const alternar = (id: string) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  if (!aberto) {
    return (
      <Button variante="contorno" onClick={() => setAberto(true)} disabled={!achados.length}>
        <FileText /> Relatório de correções para o cliente
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-titulo">Relatório de correções para o cliente</h2>
          <p className="text-sm text-muted-foreground">
            Para cada achado escolhido: o que encontramos, a possível economia, como corrigir, os produtos com o código fiscal certo e as notas. A planilha traz os
            produtos para ajustar o cadastro do sistema de vendas. Achado de antes desta versão sai só com as notas de exemplo: clique em &ldquo;Analisar agora&rdquo; para
            refazer a análise com a lista completa de produtos.
          </p>
        </div>
        <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => setMarcados(new Set(achados.map((a) => a.id)))}>
          Marcar todos
        </Button>
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => setMarcados(new Set(achados.filter((a) => a.tipo === "oportunidade").map((a) => a.id)))}>
          Só oportunidades
        </Button>
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => setMarcados(new Set())}>
          Limpar
        </Button>
      </div>

      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2" aria-label="Achados do relatório">
        {achados.map((a) => (
          <li key={a.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50">
              <Checkbox checked={marcados.has(a.id)} onChange={() => alternar(a.id)} className="mt-0.5" aria-label={a.titulo} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{a.titulo}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {formatarCompetencia(a.competencia)} · {ROTULO_REGRA[a.regra] ?? a.regra}
                  <Badge variante={TIPO_ACHADO[a.tipo]?.tom ?? "neutro"}>{TIPO_ACHADO[a.tipo]?.rotulo ?? a.tipo}</Badge>
                  <Badge variante={SITUACAO_ACHADO[a.situacao]?.tom ?? "neutro"}>{SITUACAO_ACHADO[a.situacao]?.rotulo ?? a.situacao}</Badge>
                </span>
              </span>
              {a.tipo === "oportunidade" && Number(a.valor_estimado ?? 0) > 0 ? <span className="numero text-sm font-medium text-sucesso">{formatarMoeda(a.valor_estimado)}</span> : null}
            </label>
          </li>
        ))}
      </ul>

      <p className="text-sm">
        {escolhidos.length} {escolhidos.length === 1 ? "achado escolhido" : "achados escolhidos"}
        {economia > 0 ? ` · possível economia de ${formatarMoeda(economia)}` : ""}
      </p>
      {novos ? <Alerta tom="alerta">{novos === 1 ? "1 achado escolhido ainda não foi revisado" : `${novos} achados escolhidos ainda não foram revisados`}: confira antes de entregar ao cliente.</Alerta> : null}

      <Campo rotulo="Recado do escritório (opcional)" htmlFor="relatorio-recado" ajuda="Sai no começo do relatório, antes dos achados.">
        <Textarea id="relatorio-recado" rows={3} maxLength={2000} value={recado} onChange={(e) => setRecado(e.target.value)} placeholder="Ex.: Seguem os pontos que encontramos nas notas de agosto a outubro. Ajuste o cadastro dos produtos e nos avise." />
      </Campo>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variante="contorno" disabled={!escolhidos.length}>
          <a href={escolhidos.length ? link("xlsx") : undefined} aria-disabled={!escolhidos.length}>
            <FileSpreadsheet /> Baixar planilha
          </a>
        </Button>
        <Button asChild variante="secundario" disabled={!escolhidos.length}>
          <a href={escolhidos.length ? link("pdf") : undefined} aria-disabled={!escolhidos.length}>
            <FileDown /> Baixar PDF
          </a>
        </Button>
        {podePublicar ? (
          <Button type="button" onClick={() => setConfirmar(true)} disabled={!escolhidos.length || confirmar}>
            <Send /> Publicar para o cliente
          </Button>
        ) : null}
      </div>

      {confirmar ? (
        <FormularioAcao acao={publicarRelatorioCorrecoes.bind(null, empresaId)} aoSucesso={() => setConfirmar(false)} className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          {({ pendente }) => (
            <>
              {escolhidos.map((a) => (
                <input key={a.id} type="hidden" name="achado" value={a.id} />
              ))}
              <input type="hidden" name="recado" value={recado} />
              <p className="text-sm">
                O PDF e a planilha vão para <strong>Documentos da empresa (Relatórios)</strong> e o cliente recebe o aviso. Confira o PDF antes de publicar.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variante="fantasma" onClick={() => setConfirmar(false)} disabled={pendente}>
                  Cancelar
                </Button>
                <BotaoEnviar pendente={pendente} textoPendente="Publicando...">
                  Confirmar e publicar
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      ) : null}
    </div>
  );
}
