"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatarMoeda } from "@/lib/dinheiro";
import { lancarComissoes } from "@/lib/gestao/acoes-vendedores";

/** Imprime a página (ou salva em PDF pela impressão do navegador). */
export function BotaoImprimir() {
  return (
    <Button variante="contorno" onClick={() => window.print()} className="print:hidden">
      <Printer /> Imprimir ou PDF
    </Button>
  );
}

/** Lança as comissões ainda não lançadas do período no Contas a pagar (um título por vendedor). */
export function LancarComissoes({
  empresaId,
  inicio,
  fim,
  aLancar,
  categorias,
  vencimentoPadrao,
}: {
  empresaId: string;
  inicio: string;
  fim: string;
  aLancar: number;
  categorias: { id: string; nome: string }[];
  vencimentoPadrao: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const sugerida = categorias.find((c) => /comiss/i.test(c.nome))?.id ?? "";
  const [categoria, setCategoria] = React.useState(sugerida);
  const [vencimento, setVencimento] = React.useState(vencimentoPadrao);
  const [pendente, iniciar] = React.useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await lancarComissoes(empresaId, { inicio, fim, vencimento, categoria });
      if (r.ok) {
        toast.success(r.mensagem ?? "Lançado.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível lançar.");
    });
  }

  return (
    <>
      <Button onClick={() => setAberto(true)} disabled={aLancar <= 0} className="print:hidden">
        <HandCoins /> Lançar no Contas a pagar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo="Lançar as comissões no Contas a pagar"
          descricao={`Cria uma conta a pagar para cada vendedor com as comissões ainda não lançadas deste período (${formatarMoeda(aLancar)}). Cada venda só é lançada uma vez.`}
        >
          <div className="space-y-4">
            <Campo rotulo="Conta de despesa" htmlFor="com-cat" obrigatorio>
              <Select id="com-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Escolha…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Vencimento (dia do pagamento aos vendedores)" htmlFor="com-venc" obrigatorio>
              <Input id="com-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </Campo>
            <div className="flex justify-end gap-2">
              <Button variante="fantasma" onClick={() => setAberto(false)}>
                Voltar
              </Button>
              <Button onClick={confirmar} disabled={pendente || !categoria || !vencimento}>
                {pendente ? <Loader2 className="animate-spin" /> : <HandCoins />} Lançar {formatarMoeda(aLancar)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
