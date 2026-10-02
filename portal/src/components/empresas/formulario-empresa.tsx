"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { PainelReceita } from "@/components/empresas/dados-receita";
import type { ResultadoAcao } from "@/lib/acoes";
import type { DadosReceita } from "@/lib/empresas/receita";
import { buscarDadosReceita } from "@/app/(app)/escritorio/empresas/acoes";
import { REGIMES, SERVICOS } from "@/lib/rotulos";
import { formatarCnpj, formatarCpf, somenteDigitos } from "@/lib/formatos";

export interface DadosEmpresaForm {
  tipo_pessoa?: string;
  documento?: string;
  razao_social?: string;
  nome_fantasia?: string | null;
  inscricao_estadual?: string | null;
  inscricao_municipal?: string | null;
  regime_tributario?: string;
  atividade_principal?: string | null;
  cnae?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
  email?: string | null;
  telefone?: string | null;
  contador_responsavel_id?: string | null;
  data_inicio_atendimento?: string | null;
  servicos?: string[];
  controla_estoque?: boolean;
  observacoes?: string | null;
  ativa?: boolean;
}

export function FormularioEmpresa({
  acao,
  inicial,
  equipe,
  edicao = false,
  somenteLeitura = false,
}: {
  acao: (anterior: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;
  inicial?: DadosEmpresaForm;
  equipe: { id: string; nome: string }[];
  edicao?: boolean;
  somenteLeitura?: boolean;
}) {
  const [tipo, setTipo] = useState(inicial?.tipo_pessoa ?? "PJ");
  const [doc, setDoc] = useState(inicial?.documento ? (inicial.tipo_pessoa === "PF" ? formatarCpf(inicial.documento) : formatarCnpj(inicial.documento)) : "");
  const servicos = new Set(inicial?.servicos ?? ["contabil", "fiscal"]);
  const [receita, setReceita] = useState<DadosReceita | null>(null);
  const [buscando, iniciarBusca] = useTransition();

  /** Consulta o CNPJ na Receita e preenche o formulário (a equipe confere antes de salvar). */
  function buscarNaReceita(form: HTMLFormElement | null) {
    if (!form) return;
    iniciarBusca(async () => {
      const r = await buscarDadosReceita(doc);
      if (!r.ok || !r.dados) {
        toast.error(r.mensagem ?? "Não foi possível consultar a Receita agora.");
        return;
      }
      const { receita: d, regime } = r.dados;
      const definir = (nome: string, valor: string | null | undefined) => {
        const campo = form.elements.namedItem(nome);
        if (valor && (campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement)) campo.value = valor;
      };
      definir("razao_social", d.razaoSocial);
      definir("nome_fantasia", d.nomeFantasia);
      definir("cnae", d.cnaePrincipal?.codigo);
      definir("atividade_principal", d.cnaePrincipal?.descricao);
      definir("logradouro", d.endereco.logradouro);
      definir("numero", d.endereco.numero);
      definir("complemento", d.endereco.complemento);
      definir("bairro", d.endereco.bairro);
      definir("cidade", d.endereco.municipio);
      definir("uf", d.endereco.uf);
      definir("cep", d.endereco.cep);
      definir("email", d.email);
      definir("telefone", d.telefones[0]);
      // Regime: sugerido pela Receita; na edição, só preenche se estiver em branco
      const regimeAtual = form.elements.namedItem("regime_tributario");
      if (regime && regimeAtual instanceof HTMLSelectElement && (!edicao || !regimeAtual.value)) regimeAtual.value = regime;
      setReceita(d);
      toast.success(r.mensagem ?? "Dados da Receita preenchidos.");
    });
  }

  return (
    <FormularioAcao acao={acao} className="space-y-6">
      {({ estado, pendente }) => (
        <fieldset disabled={somenteLeitura} className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="Tipo" htmlFor="tipo_pessoa">
              <Select id="tipo_pessoa" name="tipo_pessoa" value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={edicao}>
                <option value="PJ">Pessoa jurídica (CNPJ)</option>
                <option value="PF">Pessoa física / produtor (CPF)</option>
              </Select>
              {edicao ? <input type="hidden" name="tipo_pessoa" value={tipo} /> : null}
            </Campo>
            <Campo
              rotulo={tipo === "PJ" ? "CNPJ" : "CPF"}
              htmlFor="documento"
              obrigatorio
              erro={estado.erros?.documento}
              ajuda={tipo === "PJ" && !somenteLeitura ? "Digite o CNPJ e clique na lupa para buscar os dados na Receita." : undefined}
            >
              <div className="flex gap-2">
                <Input
                  id="documento"
                  name="documento"
                  inputMode="numeric"
                  value={doc}
                  readOnly={edicao}
                  onChange={(e) => {
                    const d = somenteDigitos(e.target.value).slice(0, tipo === "PJ" ? 14 : 11);
                    setDoc(d.length === 14 ? formatarCnpj(d) : d.length === 11 && tipo === "PF" ? formatarCpf(d) : d);
                  }}
                  placeholder={tipo === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"}
                  aria-invalid={Boolean(estado.erros?.documento)}
                />
                {tipo === "PJ" && !somenteLeitura ? (
                  <Button
                    type="button"
                    variante="contorno"
                    tamanho="icone"
                    aria-label="Buscar dados na Receita"
                    title="Buscar dados na Receita"
                    disabled={buscando || somenteDigitos(doc).length !== 14}
                    onClick={(e) => buscarNaReceita(e.currentTarget.form)}
                  >
                    {buscando ? <Loader2 className="animate-spin" /> : <Search />}
                  </Button>
                ) : null}
              </div>
            </Campo>
            <Campo rotulo="Regime tributário" htmlFor="regime_tributario" obrigatorio erro={estado.erros?.regime_tributario}>
              <Select id="regime_tributario" name="regime_tributario" defaultValue={inicial?.regime_tributario ?? ""}>
                <option value="" disabled>
                  Selecione
                </option>
                {Object.entries(REGIMES).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo={tipo === "PJ" ? "Razão social" : "Nome completo"} htmlFor="razao_social" obrigatorio erro={estado.erros?.razao_social} className="sm:col-span-2">
              <Input id="razao_social" name="razao_social" defaultValue={inicial?.razao_social ?? ""} />
            </Campo>
            <Campo rotulo="Nome fantasia" htmlFor="nome_fantasia">
              <Input id="nome_fantasia" name="nome_fantasia" defaultValue={inicial?.nome_fantasia ?? ""} />
            </Campo>
            <Campo rotulo="Inscrição estadual" htmlFor="inscricao_estadual">
              <Input id="inscricao_estadual" name="inscricao_estadual" defaultValue={inicial?.inscricao_estadual ?? ""} />
            </Campo>
            <Campo rotulo="Inscrição municipal" htmlFor="inscricao_municipal">
              <Input id="inscricao_municipal" name="inscricao_municipal" defaultValue={inicial?.inscricao_municipal ?? ""} />
            </Campo>
            <Campo rotulo="CNAE principal" htmlFor="cnae">
              <Input id="cnae" name="cnae" defaultValue={inicial?.cnae ?? ""} placeholder="0000-0/00" />
            </Campo>
            <Campo rotulo="Atividade principal" htmlFor="atividade_principal" className="sm:col-span-2 lg:col-span-3">
              <Input id="atividade_principal" name="atividade_principal" defaultValue={inicial?.atividade_principal ?? ""} />
            </Campo>
          </section>

          {receita ? (
            <section className="space-y-2">
              <PainelReceita dados={receita} />
              <input type="hidden" name="dados_receita" value={JSON.stringify(receita)} />
              {!edicao && receita.socios.length ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="cadastrar_socios" defaultChecked />
                  Cadastrar {receita.socios.length === 1 ? "o sócio" : `os ${receita.socios.length} sócios`} como contatos da empresa (sem e-mail e telefone; não recebem
                  lembretes)
                </label>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Endereço e contato</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <Campo rotulo="Logradouro" htmlFor="logradouro" className="lg:col-span-3">
                <Input id="logradouro" name="logradouro" defaultValue={inicial?.logradouro ?? ""} />
              </Campo>
              <Campo rotulo="Número" htmlFor="numero">
                <Input id="numero" name="numero" defaultValue={inicial?.numero ?? ""} />
              </Campo>
              <Campo rotulo="Complemento" htmlFor="complemento" className="lg:col-span-2">
                <Input id="complemento" name="complemento" defaultValue={inicial?.complemento ?? ""} />
              </Campo>
              <Campo rotulo="Bairro" htmlFor="bairro" className="lg:col-span-2">
                <Input id="bairro" name="bairro" defaultValue={inicial?.bairro ?? ""} />
              </Campo>
              <Campo rotulo="Cidade" htmlFor="cidade" className="lg:col-span-2">
                <Input id="cidade" name="cidade" defaultValue={inicial?.cidade ?? ""} />
              </Campo>
              <Campo rotulo="UF" htmlFor="uf" erro={estado.erros?.uf}>
                <Input id="uf" name="uf" maxLength={2} defaultValue={inicial?.uf ?? ""} className="uppercase" />
              </Campo>
              <Campo rotulo="CEP" htmlFor="cep">
                <Input id="cep" name="cep" inputMode="numeric" defaultValue={inicial?.cep ?? ""} />
              </Campo>
              <Campo rotulo="E-mail da empresa" htmlFor="email" erro={estado.erros?.email} className="lg:col-span-3">
                <Input id="email" name="email" type="email" defaultValue={inicial?.email ?? ""} />
              </Campo>
              <Campo rotulo="Telefone" htmlFor="telefone" className="lg:col-span-3">
                <Input id="telefone" name="telefone" type="tel" defaultValue={inicial?.telefone ?? ""} />
              </Campo>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Atendimento</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Contador responsável" htmlFor="contador_responsavel_id">
                <Select id="contador_responsavel_id" name="contador_responsavel_id" defaultValue={inicial?.contador_responsavel_id ?? ""}>
                  <option value="">Não definido</option>
                  {equipe.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Início do atendimento" htmlFor="data_inicio_atendimento">
                <Input id="data_inicio_atendimento" name="data_inicio_atendimento" type="date" defaultValue={inicial?.data_inicio_atendimento ?? ""} />
              </Campo>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="controla_estoque" defaultChecked={inicial?.controla_estoque ?? false} />
                  Controla estoque (para cálculo do CMV)
                </label>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Serviços contratados</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {Object.entries(SERVICOS).map(([v, r]) => (
                  <label key={v} className="flex items-center gap-2 text-sm">
                    <Checkbox name="servicos" value={v} defaultChecked={servicos.has(v)} />
                    {r}
                  </label>
                ))}
              </div>
              {estado.erros?.servicos ? <p className="text-xs text-perigo">{estado.erros.servicos[0]}</p> : null}
              <p className="text-xs text-muted-foreground">O checklist mensal padrão é gerado conforme o regime tributário e os serviços contratados.</p>
            </fieldset>
            <Campo rotulo="Observações internas" htmlFor="observacoes">
              <Textarea id="observacoes" name="observacoes" defaultValue={inicial?.observacoes ?? ""} />
            </Campo>
          </section>

          {!somenteLeitura ? (
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>
                <Save />
                {edicao ? "Salvar alterações" : "Cadastrar empresa"}
              </BotaoEnviar>
            </div>
          ) : null}
        </fieldset>
      )}
    </FormularioAcao>
  );
}
