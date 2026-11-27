import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PawPrint } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { BotaoExcluirTutor, DialogoPaciente, DialogoTutor } from "@/components/veterinaria/cadastros";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { BotaoAbrirConta } from "@/components/veterinaria/conta";
import { formatarCep, formatarCpf, formatarData, formatarTelefone } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { ESPECIES, SEXOS, STATUS_CONTA, idadeAnimal, pendenciasTutor } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Tutor" };

export default async function PaginaTutor({ params }: PageProps<"/e/[empresaId]/veterinaria/tutores/[tutorId]">) {
  const { empresaId, tutorId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(tutorId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data: t }, { data: animais }, { data: contas }] = await Promise.all([
    ctx.supabase.from("vet_tutores").select("*").eq("id", tutorId).eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("vet_pacientes").select("id, nome, especie, raca, sexo, nascimento, ativo, obito_em").eq("tutor_id", tutorId).order("nome"),
    ctx.supabase.from("vet_contas").select("id, numero, status, created_at, paciente:vet_pacientes(nome)").eq("tutor_id", tutorId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!t) notFound();
  const falta = pendenciasTutor(t);
  const endereco = [[t.logradouro, t.numero].filter(Boolean).join(", "), t.complemento, t.bairro, [t.cidade, t.uf].filter(Boolean).join("/"), t.cep ? `CEP ${formatarCep(t.cep)}` : null]
    .filter(Boolean)
    .join(" — ");

  return (
    <>
      <CabecalhoPagina
        titulo={t.nome}
        descricao="Tutor (responsável pelos animais)"
        voltar={{ href: `${base}/pacientes`, rotulo: "Tutores e animais" }}
        acoes={
          <>
            <DialogoTutor empresaId={empresaId} tutor={t} />
            <BotaoAbrirConta empresaId={empresaId} dados={{ tutor_id: t.id }} rotulo="Nova conta" />
            {ctx.gerente ? <BotaoExcluirTutor empresaId={empresaId} tutorId={t.id} /> : null}
          </>
        }
      />
      {falta.length ? (
        <Alerta tom="alerta" className="mb-4">
          Falta {falta.join(" e ")} no cadastro. Receitas, atestados e termos devem trazer o nome, o CPF e o endereço completo do responsável.
        </Alerta>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Dados</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">CPF</dt>
                <dd>{t.cpf ? formatarCpf(t.cpf) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Telefone</dt>
                <dd>{[t.telefone, t.telefone2].filter(Boolean).map((x) => formatarTelefone(x)).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{t.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Endereço</dt>
                <dd>{endereco || "—"}</dd>
              </div>
              {t.autorizados ? (
                <div>
                  <dt className="text-muted-foreground">Pessoas autorizadas</dt>
                  <dd>{t.autorizados}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Lembretes autorizados</dt>
                <dd>{[t.aceita_whatsapp ? "WhatsApp" : null, t.aceita_email ? "e-mail" : null].filter(Boolean).join(" e ") || "nenhum"}</dd>
              </div>
              {t.observacoes ? (
                <div>
                  <dt className="text-muted-foreground">Observações</dt>
                  <dd className="whitespace-pre-line">{t.observacoes}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Animais</CardTitle>
              <DialogoPaciente empresaId={empresaId} paciente={{ tutor_id: t.id }} />
            </CardHeader>
            <CardContent className="p-0">
              {animais?.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Nome</Th>
                      <Th>Espécie e raça</Th>
                      <Th className="hidden sm:table-cell">Idade</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {animais.map((a) => (
                      <Tr key={a.id} className={!a.ativo || a.obito_em ? "opacity-60" : undefined}>
                        <Td>
                          <Link href={`${base}/pacientes/${a.id}`} className="font-medium text-primary hover:underline">
                            {a.nome}
                          </Link>
                          {a.obito_em ? <Badge className="ml-2">óbito</Badge> : !a.ativo ? <Badge className="ml-2">inativo</Badge> : null}
                        </Td>
                        <Td>
                          {ESPECIES[a.especie] ?? a.especie}
                          {a.raca ? ` · ${a.raca}` : ""} · {SEXOS[a.sexo] ?? a.sexo}
                        </Td>
                        <Td className="hidden sm:table-cell">{idadeAnimal(a.nascimento) ?? "—"}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EstadoVazio icone={PawPrint} titulo="Nenhum animal cadastrado" />
              )}
            </CardContent>
          </Card>
          {contas?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Contas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {contas.map((c) => (
                  <Link key={c.id} href={`${base}/contas/${c.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted">
                    <span>
                      Conta nº {c.numero} · {formatarData(c.created_at)}
                      {(c.paciente as unknown as { nome: string } | null)?.nome ? ` · ${(c.paciente as unknown as { nome: string }).nome}` : ""}
                    </span>
                    <Badge variante={STATUS_CONTA[c.status]?.tom ?? "neutro"}>{STATUS_CONTA[c.status]?.rotulo ?? c.status}</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
