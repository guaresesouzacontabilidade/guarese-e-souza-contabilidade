import { Alerta } from "@/components/ui/feedback";
import type { criarClienteServidor } from "@/lib/supabase/server";
import { avisoDoMunicipio } from "@/lib/nfse-emissao/aviso-municipio";

/**
 * Aviso de Configurar emissão: a empresa pode emitir pelo Emissor Nacional na
 * cidade dela? Componente do servidor, carregado dentro de um <Suspense> para
 * a tela abrir sem esperar a consulta ao governo.
 */
export async function AvisoMunicipioNfse(props: {
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>;
  empresaId: string;
  codigoMunicipio: string;
  municipio: string | null;
  ambiente: "homologacao" | "producao";
  regime: string;
}) {
  const { supabase, ...p } = props;
  const aviso = await avisoDoMunicipio(supabase, p);
  if (!aviso) return null;
  return (
    <Alerta tom={aviso.tom} className="mb-4" titulo={aviso.titulo}>
      {aviso.texto.map((t, i) => (
        <p key={i} className={i ? "mt-1" : undefined}>
          {t}
        </p>
      ))}
    </Alerta>
  );
}

export function AvisoMunicipioCarregando({ municipio }: { municipio: string | null }) {
  return (
    <Alerta tom="info" className="mb-4" titulo="Consultando a prefeitura no Emissor Nacional…">
      Verificando se esta empresa pode emitir pelo Emissor Nacional{municipio ? ` em ${municipio}` : ""}.
    </Alerta>
  );
}
