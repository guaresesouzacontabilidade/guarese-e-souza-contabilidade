import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { exigirSessao } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatarDataHora } from "@/lib/formatos";
import { STATUS_ENVIO } from "@/lib/rotulos";
import { parametro } from "@/lib/busca";
import { marcarTodasLidas } from "@/components/layout/acoes-layout";

export const metadata: Metadata = { title: "Notificações" };
const POR_PAGINA = 30;

export default async function Notificacoes({ searchParams }: PageProps<"/notificacoes">) {
  const s = await exigirSessao();
  const sp = await searchParams;
  const aba = parametro(sp, "aba", ["todas", "nao_lidas", "envios"]) || "todas";
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const rota = "/notificacoes";

  let conteudo: React.ReactNode;
  if (aba === "envios") {
    const { data } = await s.supabase
      .from("envios")
      .select("id, canal, destinatario, assunto, status, erro, created_at, enviado_em")
      .eq("user_id", s.usuarioId)
      .order("created_at", { ascending: false })
      .limit(100);
    conteudo = data?.length ? (
      <>
        <p className="mb-3 text-sm text-muted-foreground">
          Avisos enviados para você fora do portal. Quando um canal não está configurado pelo escritório, o aviso fica registrado como “não enviado” — nada é
          simulado.
        </p>
        <Table>
          <THead>
            <tr>
              <Th>Data</Th>
              <Th>Canal</Th>
              <Th>Assunto</Th>
              <Th>Situação</Th>
            </tr>
          </THead>
          <TBody>
            {data.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-sm">{formatarDataHora(e.created_at)}</Td>
                <Td className="text-sm">{e.canal === "email" ? `E-mail (${e.destinatario})` : "WhatsApp"}</Td>
                <Td className="max-w-[22rem] truncate text-sm">{e.assunto}</Td>
                <Td>
                  <Badge variante={STATUS_ENVIO[e.status]?.tom ?? "neutro"}>{STATUS_ENVIO[e.status]?.rotulo ?? e.status}</Badge>
                  {e.status === "falhou" && e.erro ? <span className="mt-1 block text-xs text-muted-foreground">{e.erro}</span> : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </>
    ) : (
      <EstadoVazio icone={Bell} titulo="Nenhum aviso enviado por e-mail ou WhatsApp" />
    );
  } else {
    let q = s.supabase
      .from("notificacoes")
      .select("id, titulo, corpo, link, lida_em, created_at, empresa:empresas(nome_fantasia, razao_social)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (aba === "nao_lidas") q = q.is("lida_em", null);
    const { data, count } = await q;
    conteudo = data?.length ? (
      <>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {data.map((n) => {
            const emp = n.empresa as { nome_fantasia: string | null; razao_social: string } | null;
            const corpo = (
              <div className={cn("px-4 py-3", !n.lida_em && "bg-bege/40")}>
                <p className={cn("flex items-center gap-2 text-sm", !n.lida_em ? "font-semibold text-titulo" : "font-medium")}>
                  {!n.lida_em ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" /> : null}
                  {n.titulo}
                </p>
                {n.corpo ? <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{n.corpo}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatarDataHora(n.created_at)}
                  {emp ? ` · ${emp.nome_fantasia ?? emp.razao_social}` : ""}
                </p>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-muted/40">{corpo}</Link> : corpo}</li>;
          })}
        </ul>
        <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => urlCom(rota, sp, { pagina: p })} />
      </>
    ) : (
      <EstadoVazio icone={Bell} titulo={aba === "nao_lidas" ? "Nenhuma notificação não lida" : "Nenhuma notificação ainda"} />
    );
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Notificações"
        descricao="Avisos do portal: documentos recebidos ou que precisam de correção, pendências, mensagens e publicações."
        acoes={
          <BotaoAcao variante="contorno" acao={marcarTodasLidas}>
            <CheckCheck /> Marcar todas como lidas
          </BotaoAcao>
        }
      />
      <AbasLink
        ativa={aba}
        abas={[
          { valor: "todas", rotulo: "Todas", href: rota },
          { valor: "nao_lidas", rotulo: "Não lidas", href: urlCom(rota, {}, { aba: "nao_lidas" }) },
          { valor: "envios", rotulo: "E-mails e WhatsApp", href: urlCom(rota, {}, { aba: "envios" }) },
        ]}
      />
      {conteudo}
    </>
  );
}
