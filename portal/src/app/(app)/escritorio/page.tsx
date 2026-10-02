import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";

export default async function VisaoGeralEscritorio() {
  await exigirEquipe();
  return <CabecalhoPagina titulo="Visão geral da carteira" descricao="Em construção" />;
}
