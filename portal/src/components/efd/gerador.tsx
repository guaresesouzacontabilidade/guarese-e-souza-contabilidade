"use client";

import * as React from "react";
import { Download, FileCog, RefreshCw } from "lucide-react";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { definirCodigoAjuste, gerarArquivoEfd, relerNotasEfd, salvarConfiguracaoEfd } from "@/lib/efd/acoes";

/** Relê os XML do mês (endereços, municípios, frete e dados do CT-e). */
export function BotaoRelerEfd({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  return (
    <BotaoAcao variante="secundario" tamanho="sm" acao={() => relerNotasEfd(empresaId, competencia)}>
      <RefreshCw /> Atualizar a leitura das notas
    </BotaoAcao>
  );
}

/** Perfil e código de receita do ICMS (E116), guardados para os próximos meses. */
export function FormConfiguracaoEfd({
  empresaId,
  perfil,
  codigoReceita,
  uf,
  presumido,
}: {
  empresaId: string;
  perfil: string;
  codigoReceita: string | null;
  uf: string | null;
  /** Crédito presumido nos CT-e emitidos (percentual e código da tabela 5.3), quando configurado. */
  presumido: { percentual: string; codigo: string } | null;
}) {
  return (
    <FormularioAcao acao={salvarConfiguracaoEfd.bind(null, empresaId)} className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Perfil" htmlFor="efd-perfil" erro={estado.erros?.perfil} ajuda={uf === "MT" ? "Mato Grosso: perfil A para todos." : "Definido pela SEFAZ do estado."}>
              <Select id="efd-perfil" name="perfil" defaultValue={perfil}>
                <option value="A">Perfil A</option>
                <option value="B">Perfil B</option>
                <option value="C">Perfil C</option>
              </Select>
            </Campo>
            <Campo
              rotulo="Código de receita do ICMS"
              htmlFor="efd-cod-rec"
              erro={estado.erros?.codigo_receita}
              ajuda="Do estado, para o ICMS normal (registro E116)."
            >
              <Input id="efd-cod-rec" name="codigo_receita" defaultValue={codigoReceita ?? ""} maxLength={20} placeholder={uf === "MT" ? "Ex.: 1112" : ""} />
            </Campo>
          </div>
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Crédito presumido nos CT-e emitidos (transportadora)</legend>
            <p className="text-xs text-muted-foreground">
              {uf === "MT"
                ? "Mato Grosso: 20% do ICMS devido nas prestações interestaduais (RICMS/MT, Anexo VI, art. 18), código MT10001003. Vazio: não usa."
                : "Só se a legislação do estado conceder e pedir o ajuste em cada CT-e (tabela 5.3). Vazio: não usa."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Percentual (%)" htmlFor="efd-presumido-pct" erro={estado.erros?.credito_presumido_cte}>
                <Input id="efd-presumido-pct" name="credito_presumido_cte" inputMode="decimal" defaultValue={presumido?.percentual.replace(".", ",") ?? ""} placeholder={uf === "MT" ? "20" : ""} maxLength={6} />
              </Campo>
              <Campo rotulo="Código do ajuste (tabela 5.3)" htmlFor="efd-presumido-cod" erro={estado.erros?.credito_presumido_codigo}>
                <Input id="efd-presumido-cod" name="credito_presumido_codigo" defaultValue={presumido?.codigo ?? ""} placeholder={uf === "MT" ? "MT10001003" : ""} maxLength={12} className="uppercase" />
              </Campo>
            </div>
          </fieldset>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} variante="secundario">
              Salvar configuração
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

const DIGITO_TIPO: Record<string, string> = { outro_debito: "0", estorno_credito: "1", outro_credito: "2", estorno_debito: "3", deducao: "4" };

/** Código de ajuste (tabela 5.1.1) de um lançamento da apuração. */
export function FormCodigoAjuste({ empresaId, id, tipo, codigo, uf }: { empresaId: string; id: string; tipo: string; codigo: string | null; uf: string | null }) {
  const exemplo = `${uf ?? "UF"}0${DIGITO_TIPO[tipo] ?? "0"}0001`;
  return (
    <FormularioAcao acao={definirCodigoAjuste.bind(null, empresaId, id)} className="flex flex-wrap items-start gap-2">
      {({ estado, pendente }) => (
        <>
          <Input
            name="codigo"
            defaultValue={codigo ?? ""}
            aria-label="Código de ajuste"
            placeholder={`Ex.: ${exemplo}`}
            maxLength={10}
            className="h-9 w-36 uppercase"
            aria-invalid={estado.erros?.codigo ? true : undefined}
          />
          <BotaoEnviar pendente={pendente} tamanho="sm" variante="secundario" textoPendente="...">
            Salvar
          </BotaoEnviar>
          {estado.erros?.codigo ? <p className="w-full text-xs text-perigo">{estado.erros.codigo[0]}</p> : null}
        </>
      )}
    </FormularioAcao>
  );
}

/**
 * Gera o arquivo do mês. Pendências que pedem confirmação viram caixinhas;
 * depois de gerar, o link para baixar aparece aqui e no histórico.
 */
export function FormGerarEfd({
  empresaId,
  competencia,
  confirmar,
  vencimento,
  pedeVencimento,
  bloqueado,
}: {
  empresaId: string;
  competencia: string;
  confirmar: { id: string; titulo: string }[];
  vencimento: string | null;
  pedeVencimento: boolean;
  bloqueado: boolean;
}) {
  return (
    <FormularioAcao acao={gerarArquivoEfd.bind(null, empresaId, competencia)} className="space-y-4">
      {({ estado, pendente }) => {
        const gerado = estado.ok ? (estado.dados as { id?: string } | undefined)?.id : undefined;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Finalidade" htmlFor="efd-finalidade" ajuda="Substituto: para retificar um arquivo já transmitido.">
                <Select id="efd-finalidade" name="finalidade" defaultValue="0">
                  <option value="0">Original</option>
                  <option value="1">Substituto (retificadora)</option>
                </Select>
              </Campo>
              {pedeVencimento ? (
                <Campo rotulo="Vencimento do ICMS a recolher" htmlFor="efd-vencimento" erro={estado.erros?.vencimento} ajuda="Vai no registro E116.">
                  <Input id="efd-vencimento" name="vencimento" type="date" defaultValue={vencimento ?? ""} />
                </Campo>
              ) : null}
            </div>
            {confirmar.length ? (
              <fieldset className="space-y-2 rounded-lg border border-alerta/40 bg-alerta-bg/40 p-3">
                <legend className="px-1 text-sm font-medium">Confirme para gerar mesmo assim</legend>
                {confirmar.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-sm">
                    <Checkbox name="confirmar" value={c.id} className="mt-0.5" />
                    <span>{c.titulo}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {gerado ? (
                <a href={`/api/efd/${empresaId}/${gerado}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  <Download className="size-4" /> Baixar o arquivo gerado
                </a>
              ) : null}
              <BotaoEnviar pendente={pendente} textoPendente="Gerando..." disabled={bloqueado}>
                <FileCog /> Gerar arquivo da EFD
              </BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}
