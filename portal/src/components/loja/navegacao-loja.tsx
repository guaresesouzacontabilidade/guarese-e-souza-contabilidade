import Link from "next/link";
import { Store } from "lucide-react";
import { SubNavegacao } from "@/components/ui/subnav";
import { EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

/** Abas da gestão da loja. */
export function NavegacaoLoja({ empresaId, configurar }: { empresaId: string; configurar: boolean }) {
  const base = `/e/${empresaId}/loja`;
  const itens = [
    { rotulo: "Painel", href: base, exato: true },
    { rotulo: "Vender", href: `${base}/vender` },
    { rotulo: "Caixa", href: `${base}/caixa` },
    { rotulo: "Produtos e estoque", href: `${base}/produtos` },
    { rotulo: "Vendas e orçamentos", href: `${base}/vendas` },
  ];
  if (configurar) itens.push({ rotulo: "Configurações", href: `${base}/configuracoes` });
  return <SubNavegacao itens={itens} />;
}

/** Tela mostrada quando a empresa não aderiu à gestão da loja (ou a pessoa não tem acesso a ela). */
export function LojaIndisponivel({ empresaId, equipe, ativa }: { empresaId: string; equipe: boolean; ativa: boolean }) {
  if (ativa) {
    return (
      <EstadoVazio
        icone={Store}
        titulo="Você não tem acesso à loja"
        descricao="Peça ao responsável pela empresa para liberar a permissão “Vender no caixa” ou “Gerenciar a loja” para você."
      />
    );
  }
  return (
    <EstadoVazio
      icone={Store}
      titulo="Gestão da loja não contratada"
      descricao="É um serviço opcional do escritório: caixa, vendas, estoque e notas fiscais, tudo ligado automaticamente à sua contabilidade. Fale com o escritório para aderir."
      acao={
        equipe ? (
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/configuracoes`}>Ligar a gestão da loja</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
