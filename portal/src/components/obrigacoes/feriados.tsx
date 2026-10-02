"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { adicionarFeriado, removerFeriado } from "@/lib/obrigacoes/acoes";
import { ABRANGENCIAS, TIPOS_FERIADO, UFS } from "@/lib/obrigacoes/rotulos";
import { SeletorMunicipio } from "./seletor-municipio";

export function NovoFeriado({ local }: { local: { uf: string | null; municipio: string | null; municipios: { ibge: string; nome: string }[] } }) {
  const [aberto, setAberto] = useState(false);
  const [abrangencia, setAbrangencia] = useState("municipal");
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus /> Cadastrar feriado
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto ? (
          <DialogContent
            titulo="Cadastrar feriado"
            descricao="Os prazos das tarefas abertas são recalculados automaticamente. Informe a lei ou o decreto que institui o feriado."
          >
            <FormularioAcao acao={adicionarFeriado} aoSucesso={() => setAberto(false)}>
              {({ estado, pendente }) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Data" htmlFor="data" obrigatorio erro={estado.erros?.data}>
                    <Input id="data" name="data" type="date" />
                  </Campo>
                  <Campo rotulo="Tipo" htmlFor="tipo">
                    <Select id="tipo" name="tipo" defaultValue="feriado">
                      {Object.entries(TIPOS_FERIADO).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Nome" htmlFor="nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                    <Input id="nome" name="nome" placeholder="Ex.: Aniversário do município" />
                  </Campo>
                  <Campo rotulo="Abrangência" htmlFor="abrangencia" erro={estado.erros?.abrangencia}>
                    <Select id="abrangencia" name="abrangencia" value={abrangencia} onChange={(e) => setAbrangencia(e.target.value)}>
                      {Object.entries(ABRANGENCIAS).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  {abrangencia === "estadual" ? (
                    <Campo rotulo="Estado" htmlFor="uf" erro={estado.erros?.uf}>
                      <Select id="uf" name="uf" defaultValue={local.uf ?? ""}>
                        <option value="">UF</option>
                        {UFS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  ) : null}
                  {abrangencia === "municipal" ? (
                    <Campo rotulo="Município" htmlFor="municipio" erro={estado.erros?.municipio} className="sm:col-span-2">
                      <SeletorMunicipio ufInicial={local.uf} municipioInicial={local.municipio} municipiosIniciais={local.municipios} nomeCampo="municipio" nomeUf="uf" />
                    </Campo>
                  ) : null}
                  <Campo rotulo="Fonte (lei, decreto ou portaria)" htmlFor="fonte" obrigatorio erro={estado.erros?.fonte} className="sm:col-span-2">
                    <Input id="fonte" name="fonte" placeholder="Ex.: Lei Municipal nº 1.234/2001" />
                  </Campo>
                  <div className="flex justify-end sm:col-span-2">
                    <BotaoEnviar pendente={pendente}>Cadastrar</BotaoEnviar>
                  </div>
                </div>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function RemoverFeriado({ id, nome }: { id: string; nome: string }) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="iconeSm"
      aria-label={`Remover ${nome}`}
      acao={() => removerFeriado(id)}
      confirmar={{
        titulo: "Remover este feriado?",
        descricao: "Os prazos das tarefas abertas serão recalculados sem este feriado.",
        textoConfirmar: "Remover",
        perigo: true,
      }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}
