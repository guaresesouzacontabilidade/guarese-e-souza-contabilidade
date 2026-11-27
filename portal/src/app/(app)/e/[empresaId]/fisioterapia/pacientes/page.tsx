import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { DialogoPaciente } from "@/components/fisioterapia/cadastros";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { hojeClinica } from "@/lib/veterinaria/contexto";
import { diaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData, formatarTelefone } from "@/lib/formatos";
import { idade } from "@/lib/fisioterapia/rotulos";
import { aplicarBusca } from "@/lib/busca";
import { CampoBusca } from "@/components/ui/campo-busca";

export const metadata: Metadata = { title: "Pacientes da clínica" };

export default async function PaginaPacientesFisio({ params, searchParams }: PageProps<"/e/[empresaId]/fisioterapia/pacientes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const inativos = sp.inativos === "1";
  const base = `/e/${empresaId}/fisioterapia`;
  const hoje = hojeClinica();
  let q = ctx.supabase
    .from("fisio_pacientes")
    .select("id, nome, nome_social, cpf, nascimento, telefone, convenio, ativo, consentimento_em")
    .eq("empresa_id", empresaId)
    .eq("ativo", !inativos)
    .order("nome")
    .limit(300);
  q = aplicarBusca(q, busca);
  const [{ data: pacientes }, { data: proximos }, { data: pacotes }] = await Promise.all([
    q,
    ctx.supabase
      .from("fisio_agenda")
      .select("paciente_id, inicio")
      .eq("empresa_id", empresaId)
      .gte("inicio", new Date().toISOString())
      .in("status", ["agendado", "confirmado"])
      .order("inicio")
      .limit(1000),
    ctx.supabase.rpc("fisio_pacotes_resumo", { p_empresa_id: empresaId }),
  ]);
  const proximo = new Map<string, string>();
  for (const a of proximos ?? []) if (a.paciente_id && !proximo.has(a.paciente_id)) proximo.set(a.paciente_id, a.inicio);
  const pacote = new Map<string, { usadas: number; sessoes: number }>();
  for (const k of pacotes ?? []) if (k.status === "ativo" && !pacote.has(k.paciente_id)) pacote.set(k.paciente_id, { usadas: k.usadas, sessoes: k.sessoes });

  return (
    <>
      <CabecalhoPagina titulo="Pacientes" descricao="Cadastro, pacotes de sessões e próxima consulta. O prontuário fica na ficha de cada paciente." voltar={{ href: base, rotulo: "Painel da clínica" }} acoes={<DialogoPaciente empresaId={empresaId} />} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <CampoBusca defaultValue={busca} placeholder="Nome, CPF ou telefone" rotulo="Buscar paciente" className="flex-1" />
        {inativos ? <input type="hidden" name="inativos" value="1" /> : null}
        <Button type="submit" variante="contorno">
          Buscar
        </Button>
        <Button asChild variante="fantasma">
          <Link href={inativos ? `${base}/pacientes` : `${base}/pacientes?inativos=1`}>{inativos ? "Ver ativos" : "Ver inativos"}</Link>
        </Button>
      </form>
      {pacientes?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Paciente</Th>
                  <Th className="hidden md:table-cell">Telefone</Th>
                  <Th className="hidden sm:table-cell">Pacote</Th>
                  <Th>Próximo horário</Th>
                </Tr>
              </THead>
              <TBody>
                {pacientes.map((p) => {
                  const i = idade(p.nascimento, hoje);
                  const k = pacote.get(p.id);
                  const prox = proximo.get(p.id);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`${base}/pacientes/${p.id}`} className="font-medium text-primary hover:underline">
                          {p.nome_social || p.nome}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {i !== null ? `${i} anos` : "idade não informada"}
                          {p.convenio ? ` · ${p.convenio}` : " · particular"}
                          {!p.consentimento_em ? " · sem consentimento LGPD" : ""}
                        </span>
                      </Td>
                      <Td className="hidden md:table-cell">{p.telefone ? formatarTelefone(p.telefone) : "—"}</Td>
                      <Td className="hidden sm:table-cell">
                        {k ? (
                          <Badge variante={k.sessoes - k.usadas <= 2 ? "alerta" : "info"}>
                            {k.usadas}/{k.sessoes} sessões
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="text-sm">{prox ? formatarData(diaLocal(prox)) : <span className="text-muted-foreground">sem horário</span>}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={Users} titulo={busca ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"} descricao={busca ? "Confira o nome ou o CPF." : "Cadastre o primeiro paciente."} />
      )}
    </>
  );
}
