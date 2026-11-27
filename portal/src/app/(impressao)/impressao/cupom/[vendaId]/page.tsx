import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterSessao } from "@/lib/auth/sessao";
import { BotaoImprimir } from "@/components/loja/acoes-venda";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarDocumento } from "@/lib/formatos";
import { chaveEmGrupos, urlConsultaNfce } from "@/lib/nfe-emissao/nfce";
import { qrSvg } from "@/lib/honorarios/qr";

export const metadata: Metadata = { title: "Cupom fiscal" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formas de pagamento do cupom (tPag) como saem impressas. */
const FORMA: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de Crédito",
  "04": "Cartão de Débito",
  "05": "Crédito Loja",
  "10": "Vale Alimentação",
  "11": "Vale Refeição",
  "12": "Vale Presente",
  "13": "Vale Combustível",
  "15": "Boleto",
  "16": "Depósito",
  "17": "PIX",
  "18": "Transferência",
  "19": "Fidelidade",
  "20": "PIX",
  "99": "Outros",
};

interface NotaCupom {
  situacao: string | null;
  modelo?: number;
  numero?: number;
  serie?: number;
  ambiente?: "homologacao" | "producao";
  chave?: string | null;
  protocolo?: string | null;
  emitida_em?: string | null;
  autorizada_em?: string | null;
  qrcode?: string | null;
  totais?: { vProd?: string; vDesc?: string; vNF?: string } | null;
  destinatario_nome?: string | null;
  destinatario_documento?: string | null;
  emitente?: {
    uf: string;
    nome: string;
    fantasia: string | null;
    documento: string;
    inscricao_estadual: string;
    endereco: { logradouro?: string; numero?: string; bairro?: string; municipio?: string; uf?: string; cep?: string } | null;
  };
  itens?: { codigo: string; descricao: string; unidade: string; quantidade: string; valorUnitario: string }[];
  pagamentos?: { forma: string; valor: string }[];
  troco?: string | null;
}

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Araguaina", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
const qtd = (v: string) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/**
 * DANFE NFC-e (cupom fiscal) na bobina de 80 mm, conforme o leiaute do Manual
 * do DANFE NFC-e e QR Code: emitente, itens, totais e pagamentos, consulta
 * pela chave, consumidor, número/série/protocolo e o QR Code. Só sai depois
 * da autorização da SEFAZ; em homologação, com o aviso de "sem valor fiscal".
 */
export default async function CupomFiscal({ params }: PageProps<"/impressao/cupom/[vendaId]">) {
  const { vendaId } = await params;
  if (!UUID.test(vendaId)) notFound();
  const s = await obterSessao();
  if (!s) notFound();
  const { data, error } = await s.supabase.rpc("gestao_venda_nota", { p_venda_id: vendaId });
  if (error || !data) notFound();
  const n = data as unknown as NotaCupom;
  if (n.modelo !== 65 || !n.emitente) notFound();
  const autorizado = n.situacao === "autorizada" || n.situacao === "cancelada" || n.situacao === "cancelando";
  if (!autorizado || !n.chave || !n.qrcode) {
    return (
      <main className="mx-auto max-w-[76mm] p-4 text-center font-mono text-sm text-black">
        <p className="font-bold">Cupom fiscal ainda não autorizado</p>
        <p className="mt-2">O cupom só pode ser impresso depois que a SEFAZ autorizar. Volte à venda para acompanhar.</p>
      </main>
    );
  }
  const e = n.emitente;
  const teste = n.ambiente === "homologacao";
  const itens = n.itens ?? [];
  const pags = n.pagamentos ?? [];
  const total = Number(n.totais?.vNF ?? 0);
  const desconto = Number(n.totais?.vDesc ?? 0);
  const produtos = Number(n.totais?.vProd ?? total + desconto);
  const end = e.endereco ?? {};
  const endereco = [[end.logradouro, end.numero].filter(Boolean).join(", "), end.bairro, [end.municipio, end.uf].filter(Boolean).join("/"), end.cep ? `CEP ${formatarCep(end.cep)}` : null]
    .filter(Boolean)
    .join(" · ");
  const svg = await qrSvg(n.qrcode, "QR Code de consulta do cupom fiscal");
  const linha = <hr className="my-2 border-0 border-t border-dashed border-black/60" />;

  return (
    <>
      <style>{`@page { size: 80mm auto; margin: 3mm; } @media print { body { background: #fff !important; } }`}</style>
      <div className="nao-imprimir sticky top-0 z-10 flex justify-center border-b border-black/10 bg-white/95 p-3 text-sm">
        <BotaoImprimir rotulo="Imprimir cupom fiscal" />
      </div>
      <main className="mx-auto max-w-[76mm] bg-white p-3 font-mono text-[11px] leading-snug text-black" data-testid="cupom-fiscal">
        <header className="text-center">
          <p className="text-[1.1em] font-bold uppercase">{e.fantasia ?? e.nome}</p>
          {e.fantasia ? <p>{e.nome}</p> : null}
          <p>
            CNPJ {formatarDocumento(e.documento)} · IE {e.inscricao_estadual}
          </p>
          {endereco ? <p>{endereco}</p> : null}
        </header>
        {linha}
        <p className="text-center font-bold">DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
        {n.situacao !== "autorizada" ? <p className="mt-1 border border-black text-center font-bold">CUPOM CANCELADO</p> : null}
        {linha}
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="font-normal">Item</th>
              <th className="text-right font-normal">Qtde</th>
              <th className="text-right font-normal">Vl. unit.</th>
              <th className="text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i, k) => {
              const totalItem = Math.round(Number(i.quantidade) * Number(i.valorUnitario) * 100) / 100;
              return (
                <tr key={k} className="align-top">
                  <td className="pr-1">
                    {String(k + 1).padStart(3, "0")} {i.codigo} {i.descricao}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {qtd(i.quantidade)} {i.unidade}
                  </td>
                  <td className="whitespace-nowrap text-right">{formatarMoeda(i.valorUnitario).replace("R$", "").trim()}</td>
                  <td className="whitespace-nowrap text-right">{formatarMoeda(totalItem).replace("R$", "").trim()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {linha}
        <div className="space-y-0.5">
          <p className="flex justify-between">
            <span>Qtde. total de itens</span>
            <span>{itens.length}</span>
          </p>
          <p className="flex justify-between">
            <span>Valor total R$</span>
            <span>{formatarMoeda(produtos).replace("R$", "").trim()}</span>
          </p>
          {desconto > 0 ? (
            <p className="flex justify-between">
              <span>Desconto R$</span>
              <span>{formatarMoeda(desconto).replace("R$", "").trim()}</span>
            </p>
          ) : null}
          <p className="flex justify-between font-bold">
            <span>Valor a pagar R$</span>
            <span>{formatarMoeda(total).replace("R$", "").trim()}</span>
          </p>
          <p className="flex justify-between pt-1">
            <span>FORMA DE PAGAMENTO</span>
            <span>VALOR PAGO R$</span>
          </p>
          {pags.map((p, k) => (
            <p key={k} className="flex justify-between">
              <span>{FORMA[p.forma] ?? "Outros"}</span>
              <span>{formatarMoeda(p.valor).replace("R$", "").trim()}</span>
            </p>
          ))}
          {Number(n.troco ?? 0) > 0 ? (
            <p className="flex justify-between">
              <span>Troco R$</span>
              <span>{formatarMoeda(n.troco!).replace("R$", "").trim()}</span>
            </p>
          ) : null}
        </div>
        {linha}
        {teste ? <p className="text-center font-bold">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</p> : null}
        <p className="text-center">Consulte pela Chave de Acesso em</p>
        <p className="break-all text-center">{urlConsultaNfce(e.uf, n.ambiente ?? "producao")}</p>
        <p className="mt-1 text-center tracking-tight">{chaveEmGrupos(n.chave)}</p>
        {linha}
        <p className="text-center">
          {n.destinatario_documento
            ? `CONSUMIDOR - ${n.destinatario_documento.length === 11 ? "CPF" : "CNPJ"} ${formatarDocumento(n.destinatario_documento)}${
                n.destinatario_nome && n.destinatario_nome !== "Consumidor final" ? ` - ${n.destinatario_nome}` : ""
              }`
            : "CONSUMIDOR NÃO IDENTIFICADO"}
        </p>
        {linha}
        <p className="text-center">
          NFC-e nº {String(n.numero ?? "").padStart(9, "0")} Série {String(n.serie ?? "").padStart(3, "0")} {dataHora(n.emitida_em)}
        </p>
        <p className="text-center">Protocolo de autorização: {n.protocolo}</p>
        <p className="text-center">Data de autorização: {dataHora(n.autorizada_em)}</p>
        <div className="mx-auto mt-2 w-[38mm] [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </main>
    </>
  );
}
