"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/form";
import { listarMunicipios } from "@/lib/obrigacoes/acoes";
import { UFS } from "@/lib/obrigacoes/rotulos";

/** Estado + município (tabela oficial do IBGE). Envia o código IBGE no formulário. */
export function SeletorMunicipio({
  ufInicial,
  municipioInicial,
  municipiosIniciais,
  nomeCampo = "municipio_ibge",
  nomeUf = "uf",
  idBase = "municipio",
  desabilitado,
  aoMudar,
}: {
  ufInicial: string | null;
  municipioInicial: string | null;
  municipiosIniciais: { ibge: string; nome: string }[];
  nomeCampo?: string;
  nomeUf?: string;
  idBase?: string;
  desabilitado?: boolean;
  aoMudar?: (v: { uf: string; municipio: string }) => void;
}) {
  const [uf, setUf] = useState(ufInicial ?? "");
  const [municipio, setMunicipio] = useState(municipioInicial ?? "");
  const [lista, setLista] = useState(municipiosIniciais);
  const [carregando, iniciar] = useTransition();

  const trocarUf = (nova: string) => {
    setUf(nova);
    setMunicipio("");
    setLista([]);
    aoMudar?.({ uf: nova, municipio: "" });
    if (nova) iniciar(async () => setLista(await listarMunicipios(nova)));
  };

  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <Select id={`${idBase}-uf`} name={nomeUf} value={uf} onChange={(e) => trocarUf(e.target.value)} aria-label="Estado (UF)" disabled={desabilitado}>
        <option value="">UF</option>
        {UFS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </Select>
      <Select
        id={idBase}
        name={nomeCampo}
        value={municipio}
        onChange={(e) => {
          setMunicipio(e.target.value);
          aoMudar?.({ uf, municipio: e.target.value });
        }}
        aria-label="Município"
        disabled={desabilitado || !uf || carregando}
      >
        <option value="">{carregando ? "Carregando municípios..." : uf ? "Selecione o município" : "Escolha a UF primeiro"}</option>
        {lista.map((m) => (
          <option key={m.ibge} value={m.ibge}>
            {m.nome}
          </option>
        ))}
      </Select>
    </div>
  );
}
