import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { FormConfigHotel } from "@/components/hotel/cadastros";
import { FormDocumentosHotel } from "@/components/hotel/documentos";
import { LogoEmpresa } from "@/components/empresas/logo-empresa";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { enderecoDoCadastro } from "@/lib/hotel/documento";
import { formatarTelefone } from "@/lib/formatos";

export const metadata: Metadata = { title: "Configurações do hotel" };

export default async function PaginaConfigHotel({ params }: PageProps<"/e/[empresaId]/hotel/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.gerente) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const [{ data: cfg }, { data: empresa }, { data: ultima }] = await Promise.all([
    ctx.supabase.from("hotel_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, logo_path, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email")
      .eq("id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("hotel_reservas").select("id, numero").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: logo } = empresa?.logo_path ? await ctx.supabase.storage.from("empresas-logos").createSignedUrl(empresa.logo_path, 600) : { data: null };
  return (
    <>
      <CabecalhoPagina titulo="Configurações do hotel" descricao="Horários, taxa de serviço, as regras da confirmação da reserva e a aparência dos documentos do hotel." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormConfigHotel
              empresaId={empresaId}
              config={{
                hora_checkin: cfg?.hora_checkin ?? "14:00",
                hora_checkout: cfg?.hora_checkout ?? "12:00",
                taxa_servico: cfg?.taxa_servico == null ? null : Number(cfg.taxa_servico),
                cafe_incluso: cfg?.cafe_incluso ?? true,
                politica: cfg?.politica ?? null,
              }}
            />
          </CardContent>
        </Card>
        <div className="space-y-3">
          <Alerta tom="info" titulo="Quem pode usar">
            A recepção precisa da permissão “Vender no caixa”: faz reservas, check-in, check-out, lança consumo e recebe. O gerente (“Gerenciar a loja”) cadastra quartos e
            tarifas, dá descontos, estorna e vê os relatórios. Convide as pessoas em{" "}
            <Link href={`/e/${empresaId}/configuracoes`} className="underline">
              Configurações
            </Link>
            .
          </Alerta>
          <Alerta tom="sucesso" titulo="Tudo vai para a contabilidade">
            Cada pagamento de hospedagem entra no Financeiro na hora (Prestação de serviços), e o consumo baixa o estoque. As contas do caixa, do banco e da maquininha ficam
            em{" "}
            <Link href={`/e/${empresaId}/loja/configuracoes`} className="underline">
              Restaurante e bar → configurações
            </Link>
            .
          </Alerta>
          <Alerta tom="alerta" titulo="Nota fiscal e ficha de registro">
            A hospedagem é serviço: a nota é a NFS-e, emitida em Notas → Emitir nota de serviço (quando o escritório liga a emissão). A ficha de registro do hóspede (FNRH)
            sai em PDF em cada reserva; o envio ao sistema do Ministério do Turismo não é feito pelo portal.
          </Alerta>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> Documentos do hotel
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A ficha do hóspede, a confirmação da reserva, o extrato e o recibo da conta saem com a cara do hotel: só a logo dele, a cor escolhida e os contatos abaixo.
          </p>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <FormDocumentosHotel
            empresaId={empresaId}
            config={{
              modelo: cfg?.doc_modelo === "faixa" || cfg?.doc_modelo === "economico" ? cfg.doc_modelo : "classico",
              cor: cfg?.doc_cor ?? null,
              nome: cfg?.doc_nome ?? null,
              endereco: cfg?.doc_endereco ?? null,
              telefone: cfg?.doc_telefone ?? null,
              whatsapp: cfg?.doc_whatsapp ?? null,
              email: cfg?.doc_email ?? null,
              site: cfg?.doc_site ?? null,
              cadastur: cfg?.doc_cadastur ?? null,
            }}
            padroes={{
              nome: empresa?.nome_fantasia ?? empresa?.razao_social ?? "",
              endereco: empresa ? enderecoDoCadastro(empresa) : "",
              telefone: empresa?.telefone ? formatarTelefone(empresa.telefone) : "",
              email: empresa?.email ?? "",
            }}
            logoUrl={logo?.signedUrl ?? null}
            previa={ultima ? { reservaId: ultima.id, numero: ultima.numero } : null}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">Logo do hotel</p>
            {ctx.pode("empresa.editar") ? (
              <LogoEmpresa empresaId={empresaId} logoUrl={logo?.signedUrl ?? null} podeEditar />
            ) : (
              <>
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted p-3">
                  {logo?.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo.signedUrl} alt="Logo do hotel" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem logo</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">É a logo do cadastro da empresa. Para trocar, envie a imagem (PNG ou JPG) ao escritório.</p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
