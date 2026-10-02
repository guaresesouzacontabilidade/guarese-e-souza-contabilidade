import type { Metadata } from "next";
import Link from "next/link";
import { CloudDownload } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { SITUACAO_NOTAS, situacaoNotas } from "@/lib/notas-automaticas/rotulos";
import { envServidor } from "@/lib/env-servidor";
import { diasEntre, hojeISO, somarDias } from "@/lib/competencia";
import { formatarCnpj, formatarData, formatarRelativo } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Notas automáticas" };

export default async function NotasAutomaticasCarteira() {
  const s = await exigirEquipe();
  const hoje = hojeISO();
  const desde = `${somarDias(hoje, -30)}T00:00:00Z`;
  const resultado = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento").order("razao_social").range(de, ate)),
    buscarTudo((de, ate) => s.supabase.from("notas_automaticas").select("empresa_id, pausada, nfe_ativa, nfse_ativa, erros_seguidos, certificado_valido_ate, ultima_execucao, ultimo_erro").range(de, ate)),
    buscarTudo((de, ate) => s.supabase.from("documentos").select("empresa_id").eq("origem", "automatica").gte("enviado_em", desde).range(de, ate)),
  ])
    .then(([empresas, configs, docs]) => ({ empresas, configs, docs, erro: null as string | null }))
    .catch((e: unknown) => ({ empresas: [], configs: [], docs: [], erro: mensagemErro(e) }));
  const porEmpresa = new Map(resultado.configs.map((c) => [c.empresa_id, c]));
  const trazidas = new Map<string, number>();
  for (const d of resultado.docs) trazidas.set(d.empresa_id, (trazidas.get(d.empresa_id) ?? 0) + 1);

  const linhas = resultado.empresas
    .map((e) => {
      const cfg = porEmpresa.get(e.id) ?? null;
      const situacao = situacaoNotas(cfg?.certificado_valido_ate ? { valido_ate: cfg.certificado_valido_ate } : null, cfg);
      const dias = cfg?.certificado_valido_ate ? diasEntre(hoje, cfg.certificado_valido_ate.slice(0, 10)) : null;
      return { ...e, cfg, situacao, dias, notas: trazidas.get(e.id) ?? 0 };
    })
    .sort((a, b) => {
      const ordem = { erro: 0, vencido: 1, pausada: 2, ativa: 3, desconectada: 4 } as const;
      return ordem[a.situacao] - ordem[b.situacao] || (a.nome_fantasia ?? a.razao_social).localeCompare(b.nome_fantasia ?? b.razao_social, "pt-BR");
    });
  const ativas = linhas.filter((l) => l.situacao === "ativa").length;
  const comErro = linhas.filter((l) => l.situacao === "erro" || l.situacao === "vencido").length;
  const vencendo = linhas.filter((l) => l.dias !== null && l.dias >= 0 && l.dias <= 30).length;
  const chaveServidor = Boolean(envServidor.certificadosChave());

  return (
    <>
      <CabecalhoPagina
        titulo="Notas automáticas"
        descricao="Busca das notas fiscais de cada empresa na SEFAZ e no Ambiente Nacional da NFS-e com o certificado A1. Desligada em cada empresa até o certificado ser cadastrado."
      />
      {resultado.erro ? <Alerta tom="perigo" className="mb-4">{resultado.erro}</Alerta> : null}
      {!chaveServidor ? (
        <Alerta tom="alerta" className="mb-4" titulo="Cadastro de certificados indisponível">
          Falta configurar no servidor a chave de criptografia dos certificados (CERTIFICADOS_CHAVE). Veja o guia de configuração.
        </Alerta>
      ) : null}
      {envServidor.notasSemRede() ? (
        <Alerta tom="info" className="mb-4" titulo="Consultas desligadas neste ambiente">
          Este é um ambiente de demonstração ou de teste: o portal não consulta a SEFAZ nem o Ambiente Nacional daqui. No portal oficial, a busca funciona
          com o certificado da empresa.
        </Alerta>
      ) : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Indicador rotulo="Busca ativa" valor={ativas} tom={ativas ? "sucesso" : "neutro"} />
        <Indicador rotulo="Com erro ou vencido" valor={comErro} tom={comErro ? "perigo" : "neutro"} />
        <Indicador rotulo="Certificado vence em 30 dias" valor={vencendo} tom={vencendo ? "alerta" : "neutro"} />
      </div>
      {linhas.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Situação</Th>
                  <Th className="hidden md:table-cell">Certificado</Th>
                  <Th className="hidden md:table-cell">Última busca</Th>
                  <Th className="hidden sm:table-cell text-right">XML em 30 dias</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => {
                  const st = SITUACAO_NOTAS[l.situacao];
                  return (
                    <Tr key={l.id}>
                      <Td>
                        <Link href={`/e/${l.id}/notas-automaticas`} className="font-medium text-primary hover:underline">
                          {l.nome_fantasia ?? l.razao_social}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{l.documento ? formatarCnpj(l.documento) : ""}</span>
                        {l.cfg?.ultimo_erro && (l.situacao === "erro" || l.situacao === "vencido") ? (
                          <span className="block max-w-md truncate text-xs text-perigo" title={l.cfg.ultimo_erro}>
                            {l.cfg.ultimo_erro}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge variante={st.tom}>{st.rotulo}</Badge>
                      </Td>
                      <Td className={`hidden text-sm md:table-cell ${l.dias !== null && l.dias <= 30 ? "text-perigo" : ""}`}>
                        {l.cfg?.certificado_valido_ate ? `até ${formatarData(l.cfg.certificado_valido_ate.slice(0, 10))}` : "—"}
                      </Td>
                      <Td className="hidden text-sm md:table-cell">{l.cfg?.ultima_execucao ? formatarRelativo(l.cfg.ultima_execucao) : "—"}</Td>
                      <Td className="hidden text-right sm:table-cell">{l.notas || "—"}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={CloudDownload} titulo="Nenhuma empresa na carteira" />
      )}
    </>
  );
}
