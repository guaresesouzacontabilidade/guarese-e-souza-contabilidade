import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { PedirNota, type DadosIniciais } from "@/components/nfse/pedir-nota";
import { parametro } from "@/lib/busca";
import type { TomadorReceita } from "@/lib/nfse-emissao/acoes";

export const metadata: Metadata = { title: "Emitir nota de serviço" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NovaNota({ params, searchParams }: PageProps<"/e/[empresaId]/notas-servico/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const base = `/e/${empresaId}/notas-servico`;
  if (!ctx.pode("nfse.emitir")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de notas desta empresa.</Alerta>;

  const [{ data: cfg }, { data: servicos }, { data: emp }] = await Promise.all([
    ctx.supabase.from("nfse_emissao_config").select("ativa, ambiente, codigo_municipio, iss_retencao_permitida").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("nfse_servicos").select("id, nome, codigo_tributacao_nacional, descricao_padrao").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("empresas").select("regime_tributario").eq("id", empresaId).maybeSingle(),
  ]);
  if (!cfg?.ativa) {
    return (
      <>
        <CabecalhoPagina titulo="Emitir nota de serviço" voltar={{ href: base, rotulo: "Notas de serviço" }} />
        <Alerta tom="alerta" titulo="Emissão desconectada">
          A emissão de notas desta empresa ainda não foi ligada pelo escritório. <Link href={base} className="underline">Voltar</Link>
        </Alerta>
      </>
    );
  }
  const { data: municipio } = cfg.codigo_municipio
    ? await ctx.supabase.from("municipios").select("nome, uf").eq("ibge", cfg.codigo_municipio).maybeSingle()
    : { data: null };

  // "Pedir de novo": copia os dados de uma nota anterior desta empresa
  let iniciais: DadosIniciais | undefined;
  const copiar = parametro(sp, "copiar");
  if (copiar && UUID.test(copiar)) {
    const { data: n } = await ctx.supabase.from("nfse_emissoes").select("*").eq("id", copiar).eq("empresa_id", empresaId).maybeSingle();
    if (n) {
      iniciais = {
        servico_id: n.servico_id ?? undefined,
        tomador_tipo: n.tomador_tipo as DadosIniciais["tomador_tipo"],
        tomador_documento: n.tomador_documento,
        tomador_nome: n.tomador_nome,
        tomador_email: n.tomador_email,
        tomador_telefone: n.tomador_telefone,
        endereco: (n.tomador_endereco as TomadorReceita["endereco"] | null) ?? null,
        valor: n.valor,
        descricao: n.descricao,
        informacoes_complementares: n.informacoes_complementares,
      };
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Emitir nota de serviço"
        descricao="Preencha os dados e confirme: a nota é emitida na hora no Emissor Nacional da NFS-e."
        voltar={{ href: base, rotulo: "Notas de serviço" }}
      />
      {!servicos?.length ? (
        <Alerta tom="alerta">Nenhum serviço cadastrado para esta empresa. O escritório cadastra os serviços (com o código de tributação) em Configurar emissão.</Alerta>
      ) : (
        <Card>
          <CardContent className="pt-4 sm:pt-6">
            <PedirNota
              empresaId={empresaId}
              servicos={servicos.map((s) => ({ id: s.id, nome: s.nome, codigo: s.codigo_tributacao_nacional, descricaoPadrao: s.descricao_padrao }))}
              municipioEmpresa={municipio ? `${municipio.nome} / ${municipio.uf}` : (cfg.codigo_municipio ?? "Município da empresa")}
              retencaoPermitida={cfg.iss_retencao_permitida && emp?.regime_tributario !== "mei"}
              ambiente={cfg.ambiente as "homologacao" | "producao"}
              iniciais={iniciais}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
