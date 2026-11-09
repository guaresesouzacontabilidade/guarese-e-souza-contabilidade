import Link from "next/link";
import { Globe, Store, Truck } from "lucide-react";
import { SubNavegacao } from "@/components/ui/subnav";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { BotaoAcao } from "@/components/ui/acao";
import { liberarSiteLoja } from "@/lib/vitrine/acoes";
import { siteLiberado } from "@/lib/vitrine/liberacao";

/** Abas da gestão da loja ("Site da loja" só nas empresas em que o escritório liberou o site). */
export async function NavegacaoLoja({ empresaId, configurar }: { empresaId: string; configurar: boolean }) {
  const base = `/e/${empresaId}/loja`;
  const itens = [
    { rotulo: "Painel", href: base, exato: true },
    { rotulo: "Vender", href: `${base}/vender` },
    { rotulo: "Caixa", href: `${base}/caixa` },
    { rotulo: "Produtos e estoque", href: `${base}/produtos` },
    { rotulo: "Vendas e orçamentos", href: `${base}/vendas` },
  ];
  if (await siteLiberado(empresaId)) itens.push({ rotulo: "Site da loja", href: `${base}/site` });
  if (configurar) itens.push({ rotulo: "Configurações", href: `${base}/configuracoes` });
  return <SubNavegacao itens={itens} />;
}

/** Abas do site da loja (vitrine na internet ligada ao portal). */
export function NavegacaoSite({ empresaId, gerente }: { empresaId: string; gerente: boolean }) {
  const base = `/e/${empresaId}/loja/site`;
  const itens = [{ rotulo: "Pedidos do site", href: base, exato: true }];
  if (gerente) {
    itens.push(
      { rotulo: "Produtos no site", href: `${base}/produtos`, exato: false },
      { rotulo: "Categorias", href: `${base}/categorias`, exato: false },
      { rotulo: "Banners", href: `${base}/banners`, exato: false },
      { rotulo: "Configurar o site", href: `${base}/configurar`, exato: false },
      { rotulo: "Importar da FácilZap", href: `${base}/importar`, exato: false },
    );
  }
  return <SubNavegacao itens={itens} className="mb-4" />;
}

/** Tela do site da loja numa empresa sem a liberação do escritório. */
export function SiteNaoLiberado({ empresaId, equipe }: { empresaId: string; equipe: boolean }) {
  return (
    <EstadoVazio
      icone={Globe}
      titulo="Site da loja não liberado para esta empresa"
      descricao={
        equipe
          ? "O site da loja (vitrine na internet com pedidos pelo WhatsApp, ligada a esta loja) só funciona nas empresas liberadas pelo escritório."
          : "O site da loja é um serviço opcional. Fale com o escritório para saber mais."
      }
      acao={
        equipe ? (
          <BotaoAcao acao={liberarSiteLoja.bind(null, empresaId, true)} confirmar={{ titulo: "Liberar o site da loja para esta empresa?", descricao: "A aba “Site da loja” passa a aparecer para quem gerencia a loja desta empresa.", textoConfirmar: "Liberar" }}>
            Liberar o site para esta empresa
          </BotaoAcao>
        ) : undefined
      }
    />
  );
}

/** Liberação do site da loja (em Configurações da loja; só o escritório vê). */
export function LiberacaoSite({ empresaId, liberado }: { empresaId: string; liberado: boolean }) {
  return (
    <Alerta tom={liberado ? "sucesso" : "info"} titulo={liberado ? "Site da loja liberado" : "Site da loja"}>
      {liberado
        ? "A empresa tem o site da loja (vitrine na internet com pedidos pelo WhatsApp). Desligar tira o site do ar na hora; os cadastros ficam guardados."
        : "Serviço opcional: vitrine na internet ligada a esta loja, com pedidos pelo WhatsApp. Só aparece para a empresa depois de liberado aqui."}
      <div className="mt-2">
        <BotaoAcao
          variante="contorno"
          tamanho="sm"
          acao={liberarSiteLoja.bind(null, empresaId, !liberado)}
          confirmar={
            liberado
              ? { titulo: "Desligar o site da loja?", descricao: "O site sai do ar e para de receber pedidos. Os produtos, fotos e banners ficam guardados para religar depois.", textoConfirmar: "Desligar", perigo: true }
              : { titulo: "Liberar o site da loja para esta empresa?", descricao: "A aba “Site da loja” passa a aparecer para quem gerencia a loja desta empresa.", textoConfirmar: "Liberar" }
          }
        >
          {liberado ? "Desligar o site" : "Liberar o site para esta empresa"}
        </BotaoAcao>
      </div>
    </Alerta>
  );
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
