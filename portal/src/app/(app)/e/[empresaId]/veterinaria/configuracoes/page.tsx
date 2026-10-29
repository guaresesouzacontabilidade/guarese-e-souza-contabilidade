import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { DialogoServico, DialogoVacinaCatalogo, DialogoVeterinario, FormularioConfigClinica } from "@/components/veterinaria/configuracoes";
import { emailConfigurado } from "@/lib/email/enviar";
import { formatarMoeda } from "@/lib/dinheiro";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { CATEGORIAS_SERVICO, ESPECIES_VACINA } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Configurações da clínica" };

export default async function PaginaConfiguracoesClinica({ params }: PageProps<"/e/[empresaId]/veterinaria/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.gerente) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const [{ data: cfg }, { data: vets }, { data: vacinas }, { data: servicos }, { data: membros }, { data: produtos }] = await Promise.all([
    ctx.supabase.from("vet_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("vet_veterinarios").select("*, perfil:perfis(nome)").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("vet_vacinas").select("*").eq("empresa_id", empresaId).order("ordem"),
    ctx.supabase.from("vet_servicos").select("*").eq("empresa_id", empresaId).order("ordem"),
    ctx.supabase.from("empresa_membros").select("user_id, perfil:perfis!empresa_membros_user_id_fkey(nome)").eq("empresa_id", empresaId).eq("ativo", true).neq("papel", "equipe"),
    ctx.supabase.from("nfe_produtos").select("id, descricao").eq("empresa_id", empresaId).eq("ativo", true).order("descricao").limit(500),
  ]);
  const produtoNome = new Map((produtos ?? []).map((x) => [x.id, x.descricao]));
  const usuarios = (membros ?? []).map((m) => ({ id: m.user_id, nome: (m.perfil as unknown as { nome: string } | null)?.nome ?? "Usuário" }));
  const c = cfg ?? {
    nome_clinica: null,
    registro_crmv: null,
    telefone: null,
    email: null,
    endereco: null,
    cidade_documentos: null,
    horario_inicio: "08:00",
    horario_fim: "18:00",
    duracao_padrao_min: 30,
    lembrete_dias_antes: 7,
    lembrete_email: false,
    mensagem_vacina: null,
    mensagem_retorno: null,
  };
  const semVinculo = (vets ?? []).filter((v) => v.ativo && !v.perfil_id).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Configurações da clínica"
        descricao="Identificação nos documentos, veterinários, vacinas, preços e lembretes."
        voltar={{ href: `/e/${empresaId}/veterinaria`, rotulo: "Painel da clínica" }}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <FormularioConfigClinica empresaId={empresaId} c={c} emailConfigurado={emailConfigurado()} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Veterinários</CardTitle>
              <DialogoVeterinario empresaId={empresaId} usuarios={usuarios} />
            </CardHeader>
            <CardContent className="space-y-3">
              {!(vets ?? []).length ? (
                <Alerta tom="alerta">Cadastre os veterinários e ligue cada um ao próprio usuário: só assim eles registram prontuário, receitas, vacinas e atestados.</Alerta>
              ) : semVinculo ? (
                <Alerta tom="info">{semVinculo} veterinário(s) sem usuário do portal: não registram atos clínicos até a ligação.</Alerta>
              ) : null}
              {(vets ?? []).length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Nome</Th>
                      <Th>CRMV</Th>
                      <Th className="hidden sm:table-cell">Usuário</Th>
                      <Th />
                    </Tr>
                  </THead>
                  <TBody>
                    {(vets ?? []).map((v) => (
                      <Tr key={v.id} className={v.ativo ? undefined : "opacity-50"}>
                        <Td>
                          {v.nome}
                          {v.responsavel_tecnico ? <Badge className="ml-2" variante="info">RT</Badge> : null}
                          {v.cadastro_mapa ? <span className="block text-xs text-muted-foreground">MAPA {v.cadastro_mapa}</span> : null}
                        </Td>
                        <Td className="numero">
                          {v.crmv_uf} {v.crmv}
                        </Td>
                        <Td className="hidden sm:table-cell">{(v.perfil as unknown as { nome: string } | null)?.nome ?? <span className="text-alerta">sem usuário</span>}</Td>
                        <Td className="text-right">
                          <DialogoVeterinario empresaId={empresaId} usuarios={usuarios} v={v} />
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Vacinas</CardTitle>
              <DialogoVacinaCatalogo empresaId={empresaId} produtos={produtos ?? []} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Vacina</Th>
                    <Th>Esquema</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {(vacinas ?? []).map((v) => (
                    <Tr key={v.id} className={v.ativa ? undefined : "opacity-50"}>
                      <Td>
                        {v.nome}
                        <span className="block text-xs text-muted-foreground">
                          {ESPECIES_VACINA[v.especie] ?? v.especie}
                          {v.fabricante ? ` · ${v.fabricante}` : ""}
                          {v.produto_id && produtoNome.has(v.produto_id) ? ` · baixa: ${produtoNome.get(v.produto_id)}` : ""}
                        </span>
                      </Td>
                      <Td className="text-xs">
                        {v.doses_iniciais > 1 ? `${v.doses_iniciais} doses a cada ${v.intervalo_doses_dias} dias` : "dose única"}
                        {v.reforco_dias ? ` · reforço em ${v.reforco_dias} dias` : " · sem reforço"}
                      </Td>
                      <Td className="text-right">
                        <DialogoVacinaCatalogo empresaId={empresaId} v={v} produtos={produtos ?? []} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Serviços e preços</CardTitle>
              <DialogoServico empresaId={empresaId} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Serviço</Th>
                    <Th className="text-right">Preço</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {(servicos ?? []).map((s) => (
                    <Tr key={s.id} className={s.ativo ? undefined : "opacity-50"}>
                      <Td>
                        {s.nome}
                        <span className="block text-xs text-muted-foreground">{CATEGORIAS_SERVICO[s.categoria] ?? s.categoria}</span>
                      </Td>
                      <Td className="numero text-right">{formatarMoeda(s.preco)}</Td>
                      <Td className="text-right">
                        <DialogoServico empresaId={empresaId} s={s} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
