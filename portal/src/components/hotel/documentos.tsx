"use client";

import * as React from "react";
import { Check, Eye } from "lucide-react";
import { Campo, Input } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { salvarDocumentosHotel } from "@/lib/hotel/acoes";
import { CORES_DOCUMENTO, COR_PADRAO_DOCUMENTO, MODELOS_DOCUMENTO, type ModeloDocumento } from "@/lib/hotel/rotulos";
import { cn } from "@/lib/utils";

export interface DocumentosHotelForm {
  modelo: ModeloDocumento;
  cor: string | null;
  nome: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  site: string | null;
  cadastur: string | null;
}

/** Miniatura do modelo (só para escolher: o PDF real sai do servidor). */
function Miniatura({ modelo, cor, logoUrl }: { modelo: ModeloDocumento; cor: string; logoUrl: string | null }) {
  const logo = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="h-5 max-w-12 object-contain" />
  ) : (
    <span className="block h-4 w-9 rounded-sm" style={{ background: modelo === "economico" ? "#bbb" : cor }} />
  );
  const linhas = (
    <div className="space-y-1 px-2 pb-2">
      <span className="block h-1.5 w-1/2 rounded-sm" style={{ background: modelo === "economico" ? "#333" : cor }} />
      <span className="block h-2 w-full rounded-sm" style={{ background: modelo === "economico" ? "#ddd" : cor, opacity: modelo === "economico" ? 1 : 0.85 }} />
      {[0, 1, 2].map((i) => (
        <span key={i} className="block h-1 w-full rounded-sm bg-neutral-200" />
      ))}
    </div>
  );
  return (
    <div className="aspect-[3/4] w-full overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm">
      {modelo === "faixa" ? (
        <div className="mb-2 flex items-center gap-1.5 px-2 py-2" style={{ background: cor }}>
          <span className="rounded-sm bg-white p-0.5">{logo}</span>
          <span className="space-y-0.5">
            <span className="block h-1.5 w-12 rounded-sm bg-white/90" />
            <span className="block h-1 w-9 rounded-sm bg-white/60" />
          </span>
        </div>
      ) : modelo === "economico" ? (
        <div className="mb-2 flex flex-col items-center gap-0.5 px-2 pt-2">
          {logo}
          <span className="block h-1 w-12 rounded-sm bg-neutral-400" />
          <span className="mt-1 block h-px w-full bg-neutral-500" />
        </div>
      ) : (
        <div className="mb-2 px-2 pt-2">
          <div className="flex items-center justify-between gap-1">
            {logo}
            <span className="space-y-0.5">
              <span className="ml-auto block h-1.5 w-10 rounded-sm" style={{ background: cor }} />
              <span className="ml-auto block h-1 w-8 rounded-sm bg-neutral-300" />
            </span>
          </div>
          <span className="mt-1.5 block h-0.5 w-full" style={{ background: cor }} />
        </div>
      )}
      {linhas}
    </div>
  );
}

/**
 * Documentos do hotel (ficha, confirmação, extrato e recibo): modelo, cor e os
 * dados do cabeçalho. Só a logo do hotel, sem a marca do escritório.
 */
export function FormDocumentosHotel({
  empresaId,
  config,
  padroes,
  logoUrl,
  previa,
}: {
  empresaId: string;
  config: DocumentosHotelForm;
  /** Dados do cadastro da empresa, usados quando o campo fica vazio. */
  padroes: { nome: string; endereco: string; telefone: string; email: string };
  logoUrl: string | null;
  /** Reserva mais recente, para ver a prévia de cada modelo. */
  previa: { reservaId: string; numero: number } | null;
}) {
  const [modelo, setModelo] = React.useState<ModeloDocumento>(config.modelo);
  const [cor, setCor] = React.useState(config.cor ?? COR_PADRAO_DOCUMENTO);
  const urlPrevia = (doc: "ficha" | "conta") =>
    previa ? `/api/hotel/${empresaId}/reservas/${previa.reservaId}?doc=${doc}&modelo=${modelo}&cor=${encodeURIComponent(cor)}` : null;

  return (
    <FormularioAcao acao={salvarDocumentosHotel.bind(null, empresaId)} className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Modelo</legend>
            <input type="hidden" name="modelo" value={modelo} />
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(MODELOS_DOCUMENTO) as ModeloDocumento[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModelo(m)}
                  aria-pressed={modelo === m}
                  className={cn(
                    "relative rounded-xl border p-2 text-left transition",
                    modelo === m ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary/40",
                  )}
                >
                  <Miniatura modelo={m} cor={cor} logoUrl={logoUrl} />
                  <span className="mt-2 flex items-center gap-1 text-sm font-medium">
                    {modelo === m ? <Check className="size-4 text-primary" /> : null}
                    {MODELOS_DOCUMENTO[m].rotulo}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{MODELOS_DOCUMENTO[m].descricao}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={cn("space-y-2", modelo === "economico" && "opacity-60")}>
            <legend className="text-sm font-medium">Cor do hotel {modelo === "economico" ? <span className="font-normal text-muted-foreground">(o modelo econômico sai em preto e branco)</span> : null}</legend>
            <input type="hidden" name="cor" value={cor} />
            <div className="flex flex-wrap items-center gap-2">
              {CORES_DOCUMENTO.map((c) => (
                <button
                  key={c.cor}
                  type="button"
                  title={c.nome}
                  aria-label={`Cor ${c.nome}`}
                  aria-pressed={cor === c.cor}
                  onClick={() => setCor(c.cor)}
                  className={cn("size-8 rounded-full border-2 transition", cor === c.cor ? "border-foreground scale-110" : "border-transparent")}
                  style={{ background: c.cor }}
                />
              ))}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="color" value={cor} onChange={(e) => setCor(e.target.value.toLowerCase())} className="size-8 cursor-pointer rounded border border-border bg-transparent" aria-label="Escolher outra cor" />
                Outra cor
              </label>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome do hotel nos documentos" htmlFor="doc-nome" ajuda="Vazio: usa o nome fantasia do cadastro.">
              <Input id="doc-nome" name="nome" maxLength={120} defaultValue={config.nome ?? ""} placeholder={padroes.nome} />
            </Campo>
            <Campo rotulo="Cadastur" htmlFor="doc-cadastur" ajuda="Número do cadastro no Ministério do Turismo (opcional).">
              <Input id="doc-cadastur" name="cadastur" maxLength={40} defaultValue={config.cadastur ?? ""} />
            </Campo>
            <Campo rotulo="Endereço" htmlFor="doc-endereco" className="sm:col-span-2" ajuda="Vazio: usa o endereço do cadastro da empresa.">
              <Input id="doc-endereco" name="endereco" maxLength={300} defaultValue={config.endereco ?? ""} placeholder={padroes.endereco} />
            </Campo>
            <Campo rotulo="Telefone" htmlFor="doc-telefone">
              <Input id="doc-telefone" name="telefone" maxLength={40} defaultValue={config.telefone ?? ""} placeholder={padroes.telefone || "(63) 3363-0000"} />
            </Campo>
            <Campo rotulo="WhatsApp" htmlFor="doc-whatsapp">
              <Input id="doc-whatsapp" name="whatsapp" maxLength={40} defaultValue={config.whatsapp ?? ""} placeholder="(63) 99999-0000" />
            </Campo>
            <Campo rotulo="E-mail" htmlFor="doc-email" erro={estado.erros?.email}>
              <Input id="doc-email" name="email" type="email" maxLength={200} defaultValue={config.email ?? ""} placeholder={padroes.email || "reservas@hotel.com.br"} />
            </Campo>
            <Campo rotulo="Site ou Instagram" htmlFor="doc-site">
              <Input id="doc-site" name="site" maxLength={200} defaultValue={config.site ?? ""} placeholder="@hotel ou www.hotel.com.br" />
            </Campo>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {previa ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground" title="A prévia usa o modelo e a cor escolhidos agora; nome e contatos novos aparecem depois de salvar.">
                  Prévia com a reserva nº {previa.numero}:
                </span>
                <a href={urlPrevia("ficha")!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Eye className="size-4" /> Ficha
                </a>
                <a href={urlPrevia("conta")!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Eye className="size-4" /> Extrato
                </a>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">A prévia aparece depois da primeira reserva.</span>
            )}
            <BotaoEnviar pendente={pendente}>Salvar documentos</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
