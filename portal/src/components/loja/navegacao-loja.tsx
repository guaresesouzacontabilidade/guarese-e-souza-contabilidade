import Link from "next/link";
import { Store, Truck } from "lucide-react";
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

/** Abas da modalidade "notas e transporte". */
export function NavegacaoCarregamentos({ empresaId, configurar, cte }: { empresaId: string; configurar: boolean; cte?: boolean }) {
  const base = `/e/${empresaId}/loja`;
  const itens = [
    { rotulo: "Ordens de carregamento", href: `${base}/carregamentos`, exato: true },
    { rotulo: "Nova ordem", href: `${base}/carregamentos/nova` },
    { rotulo: "Notas emitidas", href: `/e/${empresaId}/notas-produto`, exato: true },
  ];
  if (cte) itens.push({ rotulo: "CT-e (frete)", href: `/e/${empresaId}/cte`, exato: true });
  if (configurar) itens.push({ rotulo: "Configurações", href: `${base}/configuracoes` });
  return <SubNavegacao itens={itens} />;
}

/** Tela mostrada quando a empresa não aderiu à gestão da loja (ou a pessoa não tem acesso a ela). */
export function LojaIndisponivel({ empresaId, equipe, ativa, notas }: { empresaId: string; equipe: boolean; ativa: boolean; notas?: boolean }) {
  if (ativa && notas) {
    return (
      <EstadoVazio
        icone={Truck}
        titulo="Esta empresa usa a gestão de notas e transporte"
        descricao="Caixa, vendas e estoque não fazem parte desta modalidade. As vendas saem pelas ordens de carregamento e pela NF-e."
        acao={
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/carregamentos`}>Ver as ordens de carregamento</Link>
          </Button>
        }
      />
    );
  }
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

/** Tela mostrada quando as ordens de carregamento não estão disponíveis para a empresa ou para a pessoa. */
export function CarregamentosIndisponivel({ empresaId, equipe, ativa, notas }: { empresaId: string; equipe: boolean; ativa: boolean; notas: boolean }) {
  if (ativa && notas) {
    return (
      <EstadoVazio
        icone={Truck}
        titulo="Você não tem acesso às ordens de carregamento"
        descricao="Peça ao responsável pela empresa para liberar a permissão “Emitir nota de produto” para você."
      />
    );
  }
  return (
    <EstadoVazio
      icone={Truck}
      titulo={ativa ? "Esta empresa usa a gestão da loja completa" : "Gestão de notas e transporte não contratada"}
      descricao={
        ativa
          ? "As ordens de carregamento fazem parte da modalidade “Notas e transporte”, para quem vende grãos e só precisa das notas e dos carregamentos."
          : "Serviço opcional do escritório: ordens de carregamento ligadas à NF-e, com pesagem, motorista e placas. Fale com o escritório para aderir."
      }
      acao={
        equipe ? (
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/configuracoes`}>{ativa ? "Mudar a modalidade" : "Ligar a gestão"}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
