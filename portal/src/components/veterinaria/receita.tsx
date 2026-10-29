"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { emitirReceita } from "@/lib/veterinaria/acoes";
import { TIPOS_RECEITA, USOS_RECEITA, VIAS } from "@/lib/veterinaria/rotulos";

interface Item {
  chave: number;
  medicamento: string;
  concentracao: string;
  forma_farmaceutica: string;
  quantidade: string;
  via: string;
  posologia: string;
  duracao: string;
  uso: string;
}

/** O item como vai ao servidor (sem a chave da tela). */
function semChave(item: Item): Omit<Item, "chave"> {
  const copia: Partial<Item> = { ...item };
  delete copia.chave;
  return copia as Omit<Item, "chave">;
}

const vazio = (chave: number): Item => ({ chave, medicamento: "", concentracao: "", forma_farmaceutica: "", quantidade: "", via: "oral", posologia: "", duracao: "", uso: "veterinario" });

/**
 * Receita: comum, antimicrobiano de uso humano ou manipulado sujeito a
 * controle especial. A Notificação de Receita Veterinária (produto
 * industrializado controlado) sai só no sistema do MAPA.
 */
export function FormularioReceita({
  empresaId,
  pacienteId,
  atendimentoId,
  temCadastroMapa,
  tutorSemDados,
  repetir,
}: {
  empresaId: string;
  pacienteId: string;
  atendimentoId: string | null;
  temCadastroMapa: boolean;
  /** O que falta no cadastro do tutor (CPF, endereço) — os documentos pedem. */
  tutorSemDados: string[];
  /** Itens de uma receita anterior para repetir. */
  repetir?: Omit<Item, "chave">[];
}) {
  const router = useRouter();
  const [tipo, setTipo] = React.useState("simples");
  const [itens, setItens] = React.useState<Item[]>(() => (repetir?.length ? repetir.map((r, i) => ({ ...r, chave: i + 1 })) : [vazio(1)]));
  const proxima = React.useRef(itens.length + 1);
  const mudar = (chave: number, campo: keyof Item, valor: string) => setItens((l) => l.map((i) => (i.chave === chave ? { ...i, [campo]: valor } : i)));
  const magistral = tipo === "magistral_controlada";

  return (
    <FormularioAcao
      acao={emitirReceita.bind(null, empresaId)}
      aoSucesso={(r) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) router.push(`/e/${empresaId}/veterinaria/receitas/${id}`);
      }}
      atualizarAoSucesso={false}
      className="space-y-5"
    >
      {({ pendente }) => (
        <>
          <input type="hidden" name="paciente_id" value={pacienteId} />
          <input type="hidden" name="atendimento_id" value={atendimentoId ?? ""} />
          <input type="hidden" name="itens" value={JSON.stringify(itens.map(semChave))} />

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Tipo de receita</legend>
            {Object.entries(TIPOS_RECEITA).map(([v, t]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${tipo === v ? "border-primary bg-primary/5" : "border-border"}`}>
                <input type="radio" name="tipo" value={v} checked={tipo === v} onChange={() => setTipo(v)} className="mt-1" />
                <span>
                  <strong>{t.rotulo}</strong>
                  <span className="block text-muted-foreground">{t.descricao}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Alerta tom="info" titulo="Remédio controlado industrializado ou de uso humano controlado">
            Produto de uso veterinário controlado (registrado no MAPA) se prescreve pela Notificação de Receita Veterinária emitida no sistema do MAPA. Medicamento de
            uso humano controlado (Portaria SVS/MS nº 344/1998) usa o receituário oficial da Anvisa. O portal não imita esses modelos: anote o número no
            tratamento do prontuário.
          </Alerta>
          {magistral && !temCadastroMapa ? (
            <Alerta tom="alerta">Para a receita magistral controlada, informe o seu número de cadastro no MAPA nas configurações da clínica (Veterinários).</Alerta>
          ) : null}
          {tutorSemDados.length ? (
            <Alerta tom="alerta">
              Falta no cadastro do tutor: {tutorSemDados.join(", ")}. As receitas devem trazer o nome, o CPF e o endereço completo do responsável (Res. CFMV nº 1.321/2020).
            </Alerta>
          ) : null}

          <div className="space-y-4">
            {itens.map((i, n) => (
              <fieldset key={i.chave} className="space-y-3 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <legend className="text-sm font-semibold">Item {n + 1}</legend>
                  {itens.length > 1 ? (
                    <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setItens((l) => l.filter((x) => x.chave !== i.chave))} aria-label={`Remover o item ${n + 1}`}>
                      <Trash2 /> Remover
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-6">
                  <Campo rotulo={magistral ? "Substâncias ativas (fórmula)" : "Medicamento (nome comercial ou genérico)"} htmlFor={`rc-med-${i.chave}`} obrigatorio className="sm:col-span-4">
                    <Input id={`rc-med-${i.chave}`} value={i.medicamento} maxLength={300} onChange={(e) => mudar(i.chave, "medicamento", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Concentração" htmlFor={`rc-conc-${i.chave}`} obrigatorio={magistral} className="sm:col-span-2">
                    <Input id={`rc-conc-${i.chave}`} value={i.concentracao} maxLength={120} onChange={(e) => mudar(i.chave, "concentracao", e.target.value)} placeholder="Ex.: 50 mg" />
                  </Campo>
                  <Campo rotulo="Forma farmacêutica" htmlFor={`rc-forma-${i.chave}`} obrigatorio={magistral} className="sm:col-span-2">
                    <Input id={`rc-forma-${i.chave}`} value={i.forma_farmaceutica} maxLength={80} onChange={(e) => mudar(i.chave, "forma_farmaceutica", e.target.value)} placeholder="Comprimido, suspensão..." />
                  </Campo>
                  <Campo rotulo="Quantidade" htmlFor={`rc-qtd-${i.chave}`} obrigatorio className="sm:col-span-2">
                    <Input id={`rc-qtd-${i.chave}`} value={i.quantidade} maxLength={80} onChange={(e) => mudar(i.chave, "quantidade", e.target.value)} placeholder="Ex.: 1 caixa com 10" />
                  </Campo>
                  <Campo rotulo="Via" htmlFor={`rc-via-${i.chave}`} className="sm:col-span-2">
                    <Select id={`rc-via-${i.chave}`} value={i.via} onChange={(e) => mudar(i.chave, "via", e.target.value)}>
                      {Object.entries(VIAS).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Posologia (modo de usar)" htmlFor={`rc-pos-${i.chave}`} obrigatorio className="sm:col-span-6">
                    <Textarea id={`rc-pos-${i.chave}`} rows={2} value={i.posologia} maxLength={1000} onChange={(e) => mudar(i.chave, "posologia", e.target.value)} placeholder="Ex.: dar 1 comprimido a cada 12 horas por 7 dias, junto com a comida" />
                  </Campo>
                  <Campo rotulo="Duração" htmlFor={`rc-dur-${i.chave}`} className="sm:col-span-3">
                    <Input id={`rc-dur-${i.chave}`} value={i.duracao} maxLength={80} onChange={(e) => mudar(i.chave, "duracao", e.target.value)} placeholder="Ex.: 7 dias" />
                  </Campo>
                  {tipo === "simples" ? (
                    <Campo rotulo="Farmácia" htmlFor={`rc-uso-${i.chave}`} className="sm:col-span-3">
                      <Select id={`rc-uso-${i.chave}`} value={i.uso} onChange={(e) => mudar(i.chave, "uso", e.target.value)}>
                        {Object.entries(USOS_RECEITA).map(([v, r]) => (
                          <option key={v} value={v}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  ) : null}
                </div>
              </fieldset>
            ))}
            {itens.length < 30 ? (
              <Button type="button" variante="contorno" onClick={() => setItens((l) => [...l, vazio(proxima.current++)])}>
                <Plus /> Incluir medicamento
              </Button>
            ) : null}
          </div>

          {tipo !== "simples" ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="uso_continuo" className="mt-0.5" />
              <span>
                Uso contínuo
                <span className="block text-muted-foreground">
                  {magistral ? "Validade de 180 dias e quantidade para até 180 dias de tratamento." : "A receita pode ser usada por 90 dias, com a quantidade para cada 30 dias."}
                </span>
              </span>
            </label>
          ) : null}
          <Campo rotulo="Observações (saem na receita)" htmlFor="rc-obs">
            <Textarea id="rc-obs" name="observacoes" rows={2} maxLength={2000} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Emitindo...">
              Emitir receita
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
