import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { SITUACAO_ARQUIVO_FISCAL } from "@/lib/rotulos";

type Detalhes = Record<string, unknown> | null;

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const ROTULO_LEITURA: Record<string, string> = {
  invalido: "O conteúdo não é um XML válido.",
  nao_suportado: "Tipo de XML não suportado para leitura automática. O escritório fará a conferência manual.",
};

const SITUACAO_REGISTRO: Record<string, string> = {
  registrado: "Nota registrada",
  duplicado: "Nota já registrada anteriormente (mesma chave de acesso) — não foi duplicada",
  evento_registrado: "Evento registrado",
  evento_duplicado: "Evento já registrado anteriormente — não foi duplicado",
  evento_sem_nota: "Evento registrado; a nota correspondente ainda não foi enviada",
};

/**
 * Exibe o resultado da leitura automática do arquivo. Os dados lidos servem
 * de apoio à conferência: nada é lançado no financeiro sem revisão humana.
 */
export function LeituraDocumento({
  status,
  detalhes,
  extracao,
  empresaId,
  documentoId,
  podeImportar,
}: {
  status: string;
  detalhes: Detalhes;
  extracao: Detalhes;
  empresaId: string;
  documentoId: string;
  podeImportar: boolean;
}) {
  if (status === "pendente" || status === "processando") {
    return <p className="text-sm text-muted-foreground">A leitura automática está em andamento. Atualize a página em alguns instantes.</p>;
  }
  if (status === "erro") {
    return <Alerta tom="alerta">Não foi possível ler o arquivo automaticamente{detalhes?.erro ? `: ${String(detalhes.erro)}` : ""}. O escritório fará a conferência manual.</Alerta>;
  }
  if (status === "nao_aplicavel" || !detalhes) {
    return (
      <p className="text-sm text-muted-foreground">
        {detalhes?.ocr === "desativado"
          ? "A leitura automática de PDFs e imagens (OCR) está desativada. O documento será conferido pela equipe."
          : "Este tipo de arquivo não tem leitura automática. O documento será conferido pela equipe."}
      </p>
    );
  }

  const d = detalhes;
  if (typeof d.leitura === "string" && ROTULO_LEITURA[d.leitura]) {
    return <Alerta tom="alerta">{ROTULO_LEITURA[d.leitura]}</Alerta>;
  }

  // ZIP com XMLs
  if (d.tipo === "zip") {
    const n = (k: string) => Number(d[k] ?? 0);
    return (
      <div className="space-y-3">
        <dl className="divide-y divide-border">
          <Linha rotulo="XMLs no arquivo">{n("total_xml")}</Linha>
          <Linha rotulo="Lidos até agora">{n("processados")}</Linha>
          <Linha rotulo="Registrados">{n("registrados")}</Linha>
          <Linha rotulo="Já existentes">{n("duplicados")} (não duplicados)</Linha>
          <Linha rotulo="Com problema">{n("invalidos") + n("nao_suportados")}</Linha>
        </dl>
        {Array.isArray(d.ignorados) && d.ignorados.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Arquivos ignorados ({(d.ignorados as unknown[]).length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {(d.ignorados as { caminho?: string; motivo?: string }[]).map((x, i) => (
                <li key={i}>
                  {x.caminho ?? "—"} — {x.motivo ?? ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    );
  }

  // Extrato OFX
  if (d.tipo === "ofx") {
    const conta = d.conta_sugerida as { id: string; nome: string } | null;
    return (
      <div className="space-y-3">
        <dl className="divide-y divide-border">
          <Linha rotulo="Tipo">{d.tipo_conta === "cartao" ? "Fatura de cartão" : "Extrato bancário"}</Linha>
          <Linha rotulo="Banco / conta">
            {[d.banco, d.agencia, d.conta].filter(Boolean).join(" · ") || "—"}
          </Linha>
          <Linha rotulo="Período">
            {formatarData(d.inicio as string)} a {formatarData(d.fim as string)}
          </Linha>
          <Linha rotulo="Movimentações">{String(d.transacoes ?? 0)}</Linha>
          {d.saldo ? (
            <Linha rotulo="Saldo informado">
              {formatarMoeda((d.saldo as { valor?: string }).valor)} em {formatarData((d.saldo as { data?: string }).data)}
            </Linha>
          ) : null}
          <Linha rotulo="Conta no portal">{conta ? conta.nome : <span className="text-alerta-fg">Conta não identificada — escolha na importação</span>}</Linha>
        </dl>
        {podeImportar ? (
          <Link href={`/e/${empresaId}/financeiro/importar?documento=${documentoId}`} className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
            Importar movimentações deste extrato
          </Link>
        ) : null}
      </div>
    );
  }

  // Planilha
  if (d.tipo === "planilha") {
    return (
      <div className="space-y-3">
        <dl className="divide-y divide-border">
          <Linha rotulo="Linhas">{String(d.linhas ?? 0)}</Linha>
          <Linha rotulo="Movimentações reconhecidas">{String(d.transacoes_reconhecidas ?? 0)}</Linha>
          <Linha rotulo="Período">
            {formatarData(d.inicio as string)} a {formatarData(d.fim as string)}
          </Linha>
        </dl>
        {podeImportar ? (
          <Link href={`/e/${empresaId}/financeiro/importar?documento=${documentoId}`} className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
            Importar esta planilha (com conferência das colunas)
          </Link>
        ) : null}
      </div>
    );
  }

  // XML fiscal (nota ou evento)
  if (d.chave !== undefined || d.tipo === "evento") {
    const registro = d.registro as { situacao?: string; lancamentos_sugeridos?: number } | undefined;
    const avisos = (d.avisos as string[] | undefined) ?? [];
    return (
      <div className="space-y-3">
        <dl className="divide-y divide-border">
          {d.tipo === "evento" ? (
            <>
              <Linha rotulo="Evento">{String(d.descricao ?? d.tipo_evento ?? "—")}</Linha>
              <Linha rotulo="Data">{formatarDataHora(d.data as string)}</Linha>
            </>
          ) : (
            <>
              <Linha rotulo="Documento">
                {String(d.tipo ?? "")} nº {String(d.numero ?? "—")}
                {d.serie ? ` · série ${String(d.serie)}` : ""}
              </Linha>
              <Linha rotulo="Emissão">{formatarDataHora(d.data_emissao as string)}</Linha>
              <Linha rotulo="Operação">
                {d.operacao === "saida" ? "Saída (emitida pela empresa)" : d.operacao === "entrada" ? "Entrada (recebida pela empresa)" : "Não relacionada à empresa"}
              </Linha>
              <Linha rotulo="Emitente">{String(d.emitente ?? "—")}</Linha>
              <Linha rotulo="Destinatário">{String(d.destinatario ?? "—")}</Linha>
              <Linha rotulo="Valor total">{d.valor_total != null ? formatarMoeda(d.valor_total as string) : "—"}</Linha>
              <Linha rotulo="Protocolo">
                {SITUACAO_ARQUIVO_FISCAL[String(d.situacao_arquivo)] ?? "—"}
                <span className="block text-xs text-muted-foreground">Informação lida do próprio arquivo; o portal não consulta a SEFAZ.</span>
              </Linha>
            </>
          )}
          {d.chave ? (
            <Linha rotulo="Chave de acesso">
              <span className="numero break-all text-xs">{String(d.chave)}</span>
            </Linha>
          ) : null}
          {registro?.situacao ? <Linha rotulo="Registro">{SITUACAO_REGISTRO[registro.situacao] ?? registro.situacao}</Linha> : null}
          {registro?.lancamentos_sugeridos ? (
            <Linha rotulo="Financeiro">
              {registro.lancamentos_sugeridos} lançamento(s) <Badge variante="alerta">sugerido(s)</Badge> — só entram nos relatórios após revisão.
            </Linha>
          ) : null}
        </dl>
        {d.relacionado_empresa === false ? (
          <Alerta tom="alerta">O CNPJ/CPF da empresa não aparece como emitente nem destinatário desta nota. Confira se o arquivo é desta empresa.</Alerta>
        ) : null}
        {avisos.length ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  // OCR (PDF/imagem)
  if (extracao) {
    const campos = (extracao.campos as { campo: string; rotulo: string; valor: string; confianca: string }[] | undefined) ?? [];
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Leitura automática ({extracao.metodo === "ocr" ? "reconhecimento de texto na imagem" : "texto do PDF"}). Confira os valores: campos com baixa confiança estão
          destacados.
        </p>
        {extracao.aviso ? <Alerta tom="alerta">{String(extracao.aviso)}</Alerta> : null}
        {campos.length ? (
          <dl className="divide-y divide-border">
            {campos.map((c, i) => (
              <div key={i} className={c.confianca === "baixa" ? "rounded-md bg-alerta-bg/60 px-2" : undefined}>
                <Linha rotulo={c.rotulo}>
                  <span className="numero">
                    {c.campo === "valor" ? formatarMoeda(c.valor) : /^\d{4}-\d{2}-\d{2}$/.test(c.valor) ? formatarData(c.valor) : c.valor}
                  </span>{" "}
                  <Badge variante={c.confianca === "alta" ? "sucesso" : c.confianca === "media" ? "info" : "alerta"}>
                    confiança {c.confianca === "alta" ? "alta" : c.confianca === "media" ? "média" : "baixa"}
                  </Badge>
                </Linha>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum dado (valor, data, CNPJ, código de barras) foi identificado com segurança.</p>
        )}
        {extracao.texto ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Texto lido</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{String(extracao.texto)}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  return <p className="text-sm text-muted-foreground">Leitura concluída sem dados a exibir.</p>;
}

