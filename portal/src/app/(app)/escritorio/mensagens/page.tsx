import type { Metadata } from "next";
import { exigirEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ListaConversas, type LinhaConversa } from "@/components/mensagens/lista";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Central de mensagens" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function CentralMensagens({ searchParams }: PageProps<"/escritorio/mensagens">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const filtro = parametro(sp, "filtro", ["aguardando", "abertas", "resolvidas", "todas"]) || "aguardando";
  const empresa = UUID.test(parametro(sp, "empresa")) ? parametro(sp, "empresa") : "";
  const empresas = await obterEmpresasDoUsuario();
  const nomes = new Map(empresas.map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));
  const rota = "/escritorio/mensagens";

  let q = s.supabase
    .from("conversas")
    .select("id, empresa_id, assunto, tipo, status, aguardando, competencia, ultima_mensagem_em")
    .order("ultima_mensagem_em", { ascending: filtro === "aguardando" })
    .limit(300);
  if (filtro === "aguardando") q = q.eq("status", "aberta").eq("aguardando", "escritorio");
  if (filtro === "abertas") q = q.eq("status", "aberta");
  if (filtro === "resolvidas") q = q.eq("status", "resolvida");
  if (empresa) q = q.eq("empresa_id", empresa);
  const [{ data }, { data: leituras }] = await Promise.all([q, s.supabase.from("conversa_leituras").select("conversa_id, lida_em").eq("user_id", s.usuarioId)]);
  const lidas = new Map((leituras ?? []).map((l) => [l.conversa_id, l.lida_em]));
  const conversas: LinhaConversa[] = (data ?? []).map((c) => ({
    ...c,
    empresa_nome: nomes.get(c.empresa_id),
    nao_lida: !lidas.get(c.id) || lidas.get(c.id)! < c.ultima_mensagem_em,
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Central de mensagens"
        descricao="Conversas e solicitações de todas as empresas. Para iniciar uma conversa, abra a área da empresa → Mensagens."
        acoes={
          <form className="flex gap-2">
            <input type="hidden" name="filtro" value={filtro} />
            <Select name="empresa" defaultValue={empresa} aria-label="Empresa" className="w-56">
              <option value="">Todas as empresas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome_fantasia ?? e.razao_social}
                </option>
              ))}
            </Select>
            <Button type="submit" variante="secundario">
              Filtrar
            </Button>
          </form>
        }
      />
      <AbasLink
        ativa={filtro}
        abas={[
          { valor: "aguardando", rotulo: "Aguardando o escritório", href: urlCom(rota, { empresa }, {}) },
          { valor: "abertas", rotulo: "Abertas", href: urlCom(rota, { empresa }, { filtro: "abertas" }) },
          { valor: "resolvidas", rotulo: "Resolvidas", href: urlCom(rota, { empresa }, { filtro: "resolvidas" }) },
          { valor: "todas", rotulo: "Todas", href: urlCom(rota, { empresa }, { filtro: "todas" }) },
        ]}
      />
      <ListaConversas conversas={conversas} lado="escritorio" mostrarEmpresa />
    </>
  );
}
