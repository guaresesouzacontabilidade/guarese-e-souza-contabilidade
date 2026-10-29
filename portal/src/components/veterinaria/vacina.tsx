"use client";

import * as React from "react";
import { History, Syringe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { registrarVacinacao } from "@/lib/veterinaria/acoes";
import { DOSES, proximaDose } from "@/lib/veterinaria/rotulos";

export interface VacinaCatalogo {
  id: string;
  nome: string;
  fabricante: string | null;
  doses_iniciais: number;
  intervalo_doses_dias: number;
  reforco_dias: number | null;
}

/**
 * Registro de vacina na carteira. "clinica": aplicada aqui pelo veterinário
 * (com fabricante, partida, fabricação e validade do frasco). "externa":
 * vacina de carteira anterior, registrada pela recepção para o histórico e os lembretes.
 */
export function DialogoVacina({
  empresaId,
  pacienteId,
  atendimentoId,
  catalogo,
  origem,
  hoje,
}: {
  empresaId: string;
  pacienteId: string;
  atendimentoId?: string;
  catalogo: VacinaCatalogo[];
  origem: "clinica" | "externa";
  hoje: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [vacinaId, setVacinaId] = React.useState(catalogo[0]?.id ?? "");
  const [dose, setDose] = React.useState("1");
  const [aplicada, setAplicada] = React.useState(hoje);
  // Ajuste manual da próxima dose; vazio volta à sugestão do catálogo quando muda a vacina, a dose ou a data
  const [proximaManual, setProximaManual] = React.useState<string | null>(null);
  const [fabricante, setFabricante] = React.useState(catalogo[0]?.fabricante ?? "");
  const vacina = catalogo.find((v) => v.id === vacinaId) ?? null;

  const proxima = proximaManual ?? proximaDose(aplicada, dose, vacina) ?? "";

  const clinica = origem === "clinica";
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {clinica ? (
          <Button tamanho="sm">
            <Syringe /> Aplicar vacina
          </Button>
        ) : (
          <Button variante="contorno" tamanho="sm">
            <History /> Vacina anterior
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={clinica ? "Aplicar vacina" : "Registrar vacina de carteira anterior"}
        descricao={
          clinica
            ? "Os dados do frasco saem na carteira e no atestado de vacinação (Res. CFMV nº 1.321/2020). A próxima dose entra nos lembretes."
            : "Para o histórico e os lembretes. Não sai no atestado de vacinação da clínica."
        }
        largura="lg"
      >
        <FormularioAcao acao={registrarVacinacao.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <input type="hidden" name="paciente_id" value={pacienteId} />
              <input type="hidden" name="atendimento_id" value={atendimentoId ?? ""} />
              <input type="hidden" name="origem" value={origem} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Vacina" htmlFor="va-vacina" obrigatorio erro={estado.erros?.vacina_id} className="sm:col-span-2">
                  <Select
                    id="va-vacina"
                    name="vacina_id"
                    value={vacinaId}
                    onChange={(e) => {
                      setVacinaId(e.target.value);
                      setProximaManual(null);
                      setFabricante(catalogo.find((v) => v.id === e.target.value)?.fabricante ?? "");
                    }}
                  >
                    {catalogo.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                    <option value="">Outra (escrever o nome)</option>
                  </Select>
                </Campo>
                {!vacinaId ? (
                  <Campo rotulo="Nome da vacina" htmlFor="va-nome" obrigatorio className="sm:col-span-2">
                    <Input id="va-nome" name="vacina_nome" maxLength={80} />
                  </Campo>
                ) : null}
                <Campo rotulo="Dose" htmlFor="va-dose">
                  <Select id="va-dose" name="dose" value={dose} onChange={(e) => {
                      setDose(e.target.value);
                      setProximaManual(null);
                    }}>
                    {Object.entries(DOSES).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Aplicada em" htmlFor="va-aplicada" erro={estado.erros?.aplicada_em}>
                  <Input id="va-aplicada" name="aplicada_em" type="date" max={hoje} value={aplicada} onChange={(e) => {
                      setAplicada(e.target.value);
                      setProximaManual(null);
                    }} />
                </Campo>
                <Campo rotulo="Fabricante (laboratório)" htmlFor="va-fab" obrigatorio={clinica} erro={estado.erros?.fabricante}>
                  <Input id="va-fab" name="fabricante" maxLength={80} value={fabricante} onChange={(e) => setFabricante(e.target.value)} />
                </Campo>
                <Campo rotulo="Partida (lote)" htmlFor="va-partida" obrigatorio={clinica} erro={estado.erros?.partida}>
                  <Input id="va-partida" name="partida" maxLength={40} />
                </Campo>
                <Campo rotulo="Fabricação" htmlFor="va-fabricacao" obrigatorio={clinica} erro={estado.erros?.fabricacao}>
                  <Input id="va-fabricacao" name="fabricacao" type="date" />
                </Campo>
                <Campo rotulo="Validade" htmlFor="va-validade" obrigatorio={clinica} erro={estado.erros?.validade}>
                  <Input id="va-validade" name="validade" type="date" />
                </Campo>
                <Campo rotulo="Próxima dose" htmlFor="va-proxima" erro={estado.erros?.proxima_dose_em} ajuda="Sugerida pelo catálogo; ajuste se precisar. Vazio = sem lembrete.">
                  <Input id="va-proxima" name="proxima_dose_em" type="date" value={proxima} onChange={(e) => setProximaManual(e.target.value)} />
                </Campo>
                {!clinica ? (
                  <Campo rotulo="Aplicada por (clínica ou veterinário)" htmlFor="va-externo">
                    <Input id="va-externo" name="veterinario_externo" maxLength={160} />
                  </Campo>
                ) : null}
              </div>
              <Campo rotulo="Observação" htmlFor="va-obs">
                <Textarea id="va-obs" name="observacao" rows={2} maxLength={300} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{clinica ? "Registrar aplicação" : "Registrar"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
