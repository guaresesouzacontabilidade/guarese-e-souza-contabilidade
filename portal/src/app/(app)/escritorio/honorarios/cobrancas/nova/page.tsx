import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioCobranca } from "@/components/honorarios/cobrancas";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { hojeISO } from "@/lib/competencia";
import { dadosFormularioCobranca } from "../carregar-form";

export const metadata: Metadata = { title: "Nova cobrança" };

export default async function NovaCobranca() {
  const s = await exigirHonorarios();
  const { empresas, categorias } = await dadosFormularioCobranca(s);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <CabecalhoPagina
        titulo="Nova cobrança avulsa"
        descricao="Para serviços fora da mensalidade (abertura de empresa, imposto de renda, certidões...). A mensalidade sai sozinha pela ficha do cliente."
        voltar={{ href: "/escritorio/honorarios/cobrancas", rotulo: "Cobranças" }}
      />
      <Card>
        <CardContent className="pt-6">
          <FormularioCobranca empresas={empresas} categorias={categorias} hoje={hojeISO()} />
        </CardContent>
      </Card>
    </div>
  );
}
