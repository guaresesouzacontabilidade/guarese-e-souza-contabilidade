"use server";

import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { aplicarBusca, palavrasDaBusca } from "@/lib/busca";
import { gruposEmpresa, type EmpresaMenu } from "@/components/layout/navegacao";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";

/** Um resultado da busca geral (o link leva à tela certa da empresa). */
export interface ResultadoBusca {
  grupo: string;
  titulo: string;
  detalhe: string | null;
  href: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE = 5;

const data = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const juntar = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(" · ") || null;

/**
 * Busca geral dentro de uma empresa: clientes e fornecedores, produtos,
 * vendas, notas, documentos, contas a pagar e receber, hóspedes, pacientes e
 * ordens de serviço. Só procura nas telas que a pessoa tem no menu (as mesmas
 * permissões das telas) e com o acesso dela ao banco: cada cliente só acha os
 * dados da própria empresa.
 */
export async function buscarNoPortal(empresaId: string, busca: string): Promise<ResultadoBusca[]> {
  const s = await sessaoApi();
  if (!s || typeof empresaId !== "string" || !UUID.test(empresaId) || typeof busca !== "string") return [];
  const texto = busca.trim().slice(0, 80);
  if (!palavrasDaBusca(texto).length || texto.replace(/\s/g, "").length < 2) return [];
  const e = (await obterEmpresasDoUsuario()).find((x) => x.id === empresaId);
  if (!e) return [];

  const equipe = s.perfil.tipo !== "cliente";
  const menu: EmpresaMenu = {
    id: e.id,
    nome: e.nome_fantasia ?? e.razao_social,
    documento: e.documento,
    papel: e.papel,
    permissoes: [...e.permissoes],
    demonstracao: e.demonstracao,
    loja: e.loja,
    modalidade: e.gestao_modalidade,
    cte: e.cte,
    frota: e.frota,
    rhFuncionario: e.rh_funcionario,
    desligadas: e.ferramentas_desligadas,
  };
  const base = `/e/${e.id}`;
  const telas = new Set(gruposEmpresa(menu, equipe).flatMap((g) => g.itens.map((i) => i.href)));
  const tem = (rota: string) => telas.has(`${base}${rota}`);
  const sb = s.supabase;
  const numero = /^\d{1,6}$/.test(texto) ? Number(texto) : null;

  const buscas: Promise<ResultadoBusca[]>[] = [];
  const consultar = <T>(fazer: () => PromiseLike<{ data: T[] | null }>, mapear: (linha: T) => ResultadoBusca) =>
    buscas.push(
      Promise.resolve(fazer())
        .then((r) => (r.data ?? []).map(mapear))
        .catch(() => []),
    );

  // Clientes e fornecedores: a ficha na loja ou, no financeiro, as contas daquele cadastro
  const loja = tem("/loja/clientes") || tem("/loja/fornecedores");
  if (loja || tem("/financeiro")) {
    consultar(
      () => aplicarBusca(sb.from("contrapartes").select("id, nome, documento, papeis").eq("empresa_id", e.id), texto).order("nome").limit(LIMITE),
      (c) => {
        const cliente = c.papeis.includes("cliente");
        const href = loja
          ? `${base}/loja/${cliente && tem("/loja/clientes") ? "clientes" : "fornecedores"}/${c.id}`
          : `${base}/financeiro/${cliente ? "receber" : "pagar"}?contraparte=${c.id}`;
        return {
          grupo: "Clientes e fornecedores",
          titulo: c.nome,
          detalhe: juntar(c.documento ? formatarDocumento(c.documento) : null, c.papeis.map((p) => (p === "cliente" ? "cliente" : "fornecedor")).join(" e ")),
          href,
        };
      },
    );
  }
  if (tem("/loja/produtos")) {
    consultar(
      () => aplicarBusca(sb.from("nfe_produtos").select("id, codigo, descricao, valor_unitario").eq("empresa_id", e.id).eq("ativo", true), texto).order("descricao").limit(LIMITE),
      (p) => ({
        grupo: "Produtos",
        titulo: p.descricao,
        detalhe: juntar(`código ${p.codigo}`, p.valor_unitario != null ? formatarMoeda(p.valor_unitario) : null),
        href: `${base}/loja/produtos?q=${encodeURIComponent(p.codigo)}`,
      }),
    );
  }
  if (tem("/loja/vendas")) {
    consultar(
      () => {
        const q = sb.from("vendas").select("id, numero, tipo, status, cliente_nome, total, created_at").eq("empresa_id", e.id);
        return (numero != null ? q.eq("numero", numero) : aplicarBusca(q, texto)).order("created_at", { ascending: false }).limit(LIMITE);
      },
      (v) => ({
        grupo: "Vendas e orçamentos",
        titulo: `${v.tipo === "orcamento" ? "Orçamento" : "Venda"} nº ${v.numero}${v.cliente_nome ? ` — ${v.cliente_nome}` : ""}`,
        detalhe: juntar(formatarMoeda(v.total), data(v.created_at), v.status === "cancelada" ? "cancelada" : null),
        href: `${base}/loja/vendas/${v.id}`,
      }),
    );
  }
  if (tem("/documentos")) {
    consultar(
      () =>
        aplicarBusca(sb.from("documentos_fiscais").select("id, documento_id, numero, emitente_nome, destinatario_nome, valor_total, data_emissao, operacao").eq("empresa_id", e.id), texto)
          .order("data_emissao", { ascending: false })
          .limit(LIMITE),
      (n) => ({
        grupo: "Notas fiscais",
        titulo: `Nota ${n.numero ?? "sem número"} — ${(n.operacao === "entrada" ? n.emitente_nome : n.destinatario_nome) ?? n.emitente_nome ?? ""}`.trim(),
        detalhe: juntar(n.operacao === "entrada" ? "compra" : "venda", n.valor_total != null ? formatarMoeda(n.valor_total) : null, data(n.data_emissao)),
        href: `${base}/documentos/${n.documento_id}`,
      }),
    );
    consultar(
      () =>
        aplicarBusca(sb.from("documentos").select("id, titulo, nome_original, competencia").eq("empresa_id", e.id).is("excluido_em", null), texto)
          .order("enviado_em", { ascending: false })
          .limit(LIMITE),
      (d) => ({ grupo: "Documentos", titulo: d.titulo || d.nome_original, detalhe: juntar(d.titulo ? d.nome_original : null, d.competencia?.slice(0, 7).split("-").reverse().join("/")), href: `${base}/documentos/${d.id}` }),
    );
  }
  if (tem("/financeiro/pagar")) {
    consultar(
      () =>
        aplicarBusca(sb.from("lancamentos").select("id, tipo, descricao, valor_previsto, data_vencimento, situacao").eq("empresa_id", e.id), texto)
          .order("data_vencimento", { ascending: false })
          .limit(LIMITE),
      (l) => ({
        grupo: "Contas a pagar e a receber",
        titulo: l.descricao,
        detalhe: juntar(
          l.tipo === "receber" ? "a receber" : "a pagar",
          formatarMoeda(l.valor_previsto),
          data(l.data_vencimento) && `vence ${data(l.data_vencimento)}`,
          l.situacao === "quitado" ? (l.tipo === "receber" ? "recebida" : "paga") : l.situacao === "cancelado" ? "cancelada" : null,
        ),
        href: `${base}/financeiro/lancamentos/${l.id}`,
      }),
    );
  }
  if (tem("/hotel/hospedes")) {
    consultar(
      () => aplicarBusca(sb.from("hotel_hospedes").select("id, nome, cpf, cnpj, telefone").eq("empresa_id", e.id), texto).order("nome").limit(LIMITE),
      (h) => ({ grupo: "Hóspedes", titulo: h.nome, detalhe: juntar(h.cpf || h.cnpj ? formatarDocumento((h.cpf || h.cnpj)!) : null, h.telefone), href: `${base}/hotel/hospedes/${h.id}` }),
    );
  }
  if (tem("/veterinaria/pacientes")) {
    consultar(
      () => aplicarBusca(sb.from("vet_tutores").select("id, nome, telefone").eq("empresa_id", e.id), texto).order("nome").limit(LIMITE),
      (t) => ({ grupo: "Tutores e animais", titulo: t.nome, detalhe: juntar("tutor", t.telefone), href: `${base}/veterinaria/tutores/${t.id}` }),
    );
    consultar(
      () => aplicarBusca(sb.from("vet_pacientes").select("id, nome, especie").eq("empresa_id", e.id), texto).order("nome").limit(LIMITE),
      (a) => ({ grupo: "Tutores e animais", titulo: a.nome, detalhe: juntar("animal", a.especie), href: `${base}/veterinaria/pacientes/${a.id}` }),
    );
  }
  if (tem("/fisioterapia/pacientes")) {
    consultar(
      () => aplicarBusca(sb.from("fisio_pacientes").select("id, nome, nome_social, telefone").eq("empresa_id", e.id), texto).order("nome").limit(LIMITE),
      (p) => ({ grupo: "Pacientes", titulo: p.nome_social || p.nome, detalhe: p.telefone, href: `${base}/fisioterapia/pacientes/${p.id}` }),
    );
  }
  if (tem("/os")) {
    consultar(
      () => {
        const q = sb.from("os_ordens").select("id, numero, cliente_nome, etapa").eq("empresa_id", e.id);
        return (numero != null ? q.eq("numero", numero) : aplicarBusca(q, texto)).order("numero", { ascending: false }).limit(LIMITE);
      },
      (o) => ({ grupo: "Ordens de serviço", titulo: `OS nº ${o.numero} — ${o.cliente_nome}`, detalhe: o.etapa, href: `${base}/os/${o.id}` }),
    );
  }

  return (await Promise.all(buscas)).flat();
}
