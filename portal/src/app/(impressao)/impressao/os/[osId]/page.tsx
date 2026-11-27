import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterSessao } from "@/lib/auth/sessao";
import { BotaoImprimir } from "@/components/loja/acoes-venda";
import { qrSvg } from "@/lib/honorarios/qr";
import { envPublico } from "@/lib/env";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import type { Database } from "@/lib/supabase/database.types";
import { entregaPrevista, faltaReceber, formatarEntrega, formatarMinutos, PRIORIDADE } from "@/lib/os/rotulos";

export const metadata: Metadata = { title: "Ordem de serviço" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DadosVia {
  o: Database["public"]["Tables"]["os_ordens"]["Row"];
  e: { razao_social: string; nome_fantasia: string | null; documento: string; telefone: string | null; demonstracao: boolean };
  itens: Database["public"]["Tables"]["os_itens"]["Row"][];
  cfg: { nome_exibicao: string | null; telefone: string | null; rodape_impressao: string | null } | null;
  resp: { nome: string } | null;
  link: string;
  qr: string;
  /** QR Code da tela da bancada (só na via da loja e na etiqueta) */
  qrBancada: string;
  assinatura: string | null;
  loja: string;
  telefone: string | null;
  entrega: string | null;
}

function Via({ cliente, d }: { cliente: boolean; d: DadosVia }) {
  const { o, e, itens, cfg, resp, link, qr, qrBancada, assinatura, loja, telefone, entrega } = d;
  const recebido = Number(o.valor_recebido) + Number(o.valor_a_receber);
  return (
    <section className="break-inside-avoid border border-black p-4">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-2">
        <div>
          {e.demonstracao ? <p className="mb-1 inline-block border border-black px-1 text-[10px] font-bold">DEMONSTRAÇÃO — DADOS FICTÍCIOS</p> : null}
          <p className="text-base font-bold uppercase">{loja}</p>
          <p className="text-xs">
            CNPJ {formatarDocumento(e.documento)}
            {telefone ? ` · Tel. ${formatarTelefone(telefone)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">OS Nº {o.numero}</p>
          <p className="text-xs">{cliente ? "Via do cliente" : "Via da loja"}</p>
        </div>
      </header>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
        <p>
          <strong>Cliente:</strong> {o.cliente_nome}
        </p>
        <p>
          <strong>Aberta em:</strong> {formatarDataHora(o.aberta_em)}
        </p>
        {o.cliente_telefone ? (
          <p>
            <strong>Telefone:</strong> {formatarTelefone(o.cliente_telefone)}
          </p>
        ) : null}
        <p>
          <strong>{o.prazo ? "Prazo" : "Previsão"}:</strong> {formatarEntrega(entrega)}
        </p>
        {o.prioridade !== "normal" ? (
          <p>
            <strong>Prioridade:</strong> {PRIORIDADE[o.prioridade]?.rotulo}
          </p>
        ) : null}
        {!cliente && resp?.nome ? (
          <p>
            <strong>Responsável:</strong> {resp.nome}
          </p>
        ) : null}
      </div>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Serviço</th>
            <th className="py-1 text-right">Qtd.</th>
            {!cliente ? <th className="py-1 text-right">Tempo est.</th> : null}
            <th className="py-1 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {(itens ?? []).map((i) => (
            <tr key={i.id} className="border-b border-black/20">
              <td className="py-1">{i.descricao}</td>
              <td className="py-1 text-right">
                {String(i.quantidade).replace(".", ",")} {i.unidade}
              </td>
              {!cliente ? <td className="py-1 text-right">{formatarMinutos(i.minutos_estimados)}</td> : null}
              <td className="py-1 text-right">{formatarMoeda(Number(i.valor_unitario) * Number(i.quantidade))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-1">Total</td>
            <td />
            {!cliente ? <td className="py-1 text-right">{formatarMinutos(o.minutos_estimados)}</td> : null}
            <td className="py-1 text-right">{formatarMoeda(o.valor_total)}</td>
          </tr>
          {Number(o.valor_total) > 0 && recebido > 0 ? (
            <tr>
              <td className="py-0.5 text-xs" colSpan={cliente ? 3 : 4}>
                <span className="float-right">
                  Pago: {formatarMoeda(o.valor_recebido)}
                  {Number(o.valor_a_receber) > 0 ? ` · A receber: ${formatarMoeda(o.valor_a_receber)}` : ""} · <strong>Falta: {formatarMoeda(faltaReceber(o))}</strong>
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {o.descricao ? <p className="mt-2 whitespace-pre-wrap text-sm">{o.descricao}</p> : null}
      {!cliente && o.observacoes ? <p className="mt-1 whitespace-pre-wrap text-xs">Obs.: {o.observacoes}</p> : null}
      {cliente ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="w-24 shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="text-xs">
            Aponte a câmera do celular para o QR Code para acompanhar o andamento da sua OS.
            <br />
            <span className="break-all">{link}</span>
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-20 shrink-0" dangerouslySetInnerHTML={{ __html: qrBancada }} />
            <p className="text-xs">
              <strong>Bancada:</strong> aponte a câmera do celular da oficina para abrir esta OS (iniciar, pausar, fotografar e marcar pronta). Precisa estar com o portal aberto.
            </p>
          </div>
          {o.entregue_em ? (
            <div className="mt-4 grid grid-cols-2 items-end gap-6 text-xs">
              <div className="border-t border-black pt-1 text-center">
                {assinatura ? (
                  // eslint-disable-next-line @next/next/no-img-element -- assinatura privada por link temporário
                  <img src={assinatura} alt="Assinatura" className="mx-auto -mt-16 h-14 w-auto" />
                ) : null}
                Retirado por {o.retirado_por ?? "—"}
                {o.retirado_documento ? ` (doc. ${o.retirado_documento})` : ""}
              </div>
              <p className="border-t border-black pt-1 text-center">Retirada em {formatarDataHora(o.entregue_em)}</p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-6 text-xs">
              <p className="border-t border-black pt-1 text-center">Retirado por (nome e documento)</p>
              <p className="border-t border-black pt-1 text-center">Data da retirada</p>
            </div>
          )}
        </>
      )}
      {cfg?.rodape_impressao ? <p className="mt-2 whitespace-pre-wrap text-[11px]">{cfg.rodape_impressao}</p> : null}
      <p className="mt-1 text-right text-[10px]">Não é documento fiscal.</p>
    </section>
  );
}

/** Etiqueta para colar no material (10 × 7 cm): nº grande, cliente, serviços e o QR Code da bancada. */
function Etiqueta({ d }: { d: DadosVia }) {
  const { o, itens, qrBancada, loja, entrega } = d;
  return (
    <section className="etiqueta-os-impressa flex h-[64mm] w-[94mm] gap-2 overflow-hidden border border-black p-2 text-black">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[9px] font-semibold uppercase">{loja}</p>
        <p className="font-mono text-4xl font-black leading-none">OS {o.numero}</p>
        <p className="mt-1 line-clamp-2 text-sm font-bold leading-tight">{o.cliente_nome}</p>
        <ul className="mt-1 space-y-0 text-[10px] leading-tight">
          {itens.slice(0, 4).map((i) => (
            <li key={i.id} className="truncate">
              {String(i.quantidade).replace(".", ",")} {i.unidade} · {i.descricao}
            </li>
          ))}
          {itens.length > 4 ? <li>+ {itens.length - 4} serviço(s)</li> : null}
        </ul>
        <p className="mt-auto text-[10px]">
          {o.prazo ? "Prazo" : "Previsão"}: <strong>{formatarEntrega(entrega)}</strong>
          {o.prioridade !== "normal" ? <strong className="ml-1 border border-black px-1 uppercase">{PRIORIDADE[o.prioridade]?.rotulo}</strong> : null}
        </p>
      </div>
      <div className="flex w-[28mm] shrink-0 flex-col items-center justify-center">
        <div className="w-[27mm]" dangerouslySetInnerHTML={{ __html: qrBancada }} />
        <p className="text-center text-[8px] leading-tight">Bancada: aponte o celular</p>
      </div>
    </section>
  );
}

/** OS impressa: via da loja (com assinatura de retirada) e via do cliente (com o QR Code do acompanhamento); ou a etiqueta. */
export default async function ImprimirOs({ params, searchParams }: PageProps<"/impressao/os/[osId]">) {
  const { osId } = await params;
  const etiqueta = (await searchParams).etiqueta === "1";
  if (!UUID.test(osId)) notFound();
  const s = await obterSessao();
  if (!s) notFound();
  const { data: o } = await s.supabase.from("os_ordens").select("*").eq("id", osId).maybeSingle();
  if (!o) notFound();
  const [{ data: itens }, { data: e }, { data: cfg }, { data: resp }] = await Promise.all([
    s.supabase.from("os_itens").select("*").eq("ordem_id", osId).order("posicao"),
    s.supabase.from("empresas").select("razao_social, nome_fantasia, documento, telefone, demonstracao").eq("id", o.empresa_id).maybeSingle(),
    s.supabase.from("os_config").select("nome_exibicao, telefone, rodape_impressao").eq("empresa_id", o.empresa_id).maybeSingle(),
    o.responsavel_id ? s.supabase.from("os_equipe").select("nome").eq("id", o.responsavel_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!e) notFound();
  const link = `${envPublico.siteUrl()}/acompanhar/${o.codigo_publico}`;
  const qr = await qrSvg(link, `Acompanhar a OS ${o.numero}`);
  const qrBancada = await qrSvg(`${envPublico.siteUrl()}/e/${o.empresa_id}/os/${o.id}/bancada`, `Abrir a OS ${o.numero} na bancada`);
  const { data: ass } = o.assinatura_caminho && !etiqueta ? await s.supabase.storage.from("os-fotos").createSignedUrl(o.assinatura_caminho, 600) : { data: null };
  const loja = cfg?.nome_exibicao ?? e.nome_fantasia ?? e.razao_social;
  const telefone = cfg?.telefone ?? e.telefone;
  const entrega = entregaPrevista(o);
  const d: DadosVia = { o, e, itens: itens ?? [], cfg, resp, link, qr, qrBancada, assinatura: ass?.signedUrl ?? null, loja, telefone, entrega };

  if (etiqueta) {
    return (
      <>
        <style>{`@page { size: 100mm 70mm; margin: 3mm; } @media print { body { background: #fff !important; } }`}</style>
        <div className="nao-imprimir sticky top-0 z-10 flex justify-center border-b border-black/10 bg-white/95 p-3">
          <BotaoImprimir rotulo="Imprimir etiqueta" />
        </div>
        <main className="flex justify-center bg-white p-3">
          <Etiqueta d={d} />
        </main>
      </>
    );
  }


  return (
    <>
      <style>{`@page { size: A4; margin: 10mm; } @media print { body { background: #fff !important; } }`}</style>
      <div className="nao-imprimir sticky top-0 z-10 flex justify-center border-b border-black/10 bg-white/95 p-3">
        <BotaoImprimir rotulo="Imprimir OS" />
      </div>
      <main className="mx-auto max-w-[190mm] space-y-4 bg-white p-3 text-black">
        <Via cliente={false} d={d} />
        <p className="nao-imprimir text-center text-xs text-black/50">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</p>
        <Via cliente d={d} />
      </main>
    </>
  );
}
