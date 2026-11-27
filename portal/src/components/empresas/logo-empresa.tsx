"use client";

import { useState } from "react";
import { Building2, ImageUp, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input } from "@/components/ui/form";
import { enviarLogoEmpresa, removerLogoEmpresa } from "@/lib/empresas/logo";

/** Logo da empresa no cadastro: prévia, envio (PNG/JPG até 2 MB) e remoção. */
export function LogoEmpresa({ empresaId, logoUrl, podeEditar }: { empresaId: string; logoUrl: string | null; podeEditar: boolean }) {
  const [previa, setPrevia] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-56 items-center justify-center rounded-lg border border-dashed border-border bg-muted p-3">
          {previa || logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previa ?? logoUrl ?? ""}
              alt={previa ? "Prévia da nova logo" : "Logo atual da empresa"}
              className="max-h-full max-w-full object-contain"
              onError={() => setPrevia(null)}
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="size-6" /> Sem logo
            </span>
          )}
        </div>
        {podeEditar && logoUrl && !previa ? (
          <BotaoAcao
            variante="fantasma"
            tamanho="sm"
            acao={removerLogoEmpresa.bind(null, empresaId)}
            confirmar={{ titulo: "Remover a logo da empresa?", descricao: "As próximas declarações saem só com a logo do escritório.", textoConfirmar: "Remover" }}
          >
            <Trash2 /> Remover
          </BotaoAcao>
        ) : null}
      </div>
      {podeEditar ? (
        <FormularioAcao acao={enviarLogoEmpresa.bind(null, empresaId)} resetarAoSucesso aoSucesso={() => setPrevia(null)} className="flex flex-wrap items-end gap-3">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo={logoUrl ? "Trocar a logo" : "Enviar a logo"} htmlFor="empresa-logo" erro={estado.erros?.logo} ajuda="PNG ou JPG, até 2 MB. Prefira fundo transparente (PNG).">
                <Input
                  id="empresa-logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setPrevia(f && (f.type === "image/png" || f.type === "image/jpeg") ? URL.createObjectURL(f) : null);
                  }}
                />
              </Campo>
              <BotaoEnviar pendente={pendente} textoPendente="Enviando...">
                <ImageUp /> Enviar logo
              </BotaoEnviar>
            </>
          )}
        </FormularioAcao>
      ) : null}
    </div>
  );
}
