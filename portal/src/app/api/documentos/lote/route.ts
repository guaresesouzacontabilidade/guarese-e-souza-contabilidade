import { NextResponse, type NextRequest } from "next/server";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_DOCUMENTOS = 500;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB por download

function seguro(t: string) {
  return t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "arquivo";
}

/** Download de vários documentos em um único ZIP (cada acesso fica registrado). */
export async function POST(req: NextRequest) {
  // Somente a partir do próprio portal (proteção contra requisições de outros sites)
  const origem = req.headers.get("origin");
  if (!origem || new URL(origem).host !== req.nextUrl.host) return new NextResponse("Origem não permitida.", { status: 403 });
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });

  const fd = await req.formData();
  const ids = [...new Set(fd.getAll("ids").map(String).filter((v) => UUID.test(v)))].slice(0, MAX_DOCUMENTOS);
  if (!ids.length) return new NextResponse("Selecione ao menos um documento.", { status: 400 });

  const [{ data: docs }, { data: categorias }] = await Promise.all([
    s.supabase.from("documentos").select("id, empresa_id, competencia, categoria_codigo, nome_original, tamanho, empresa:empresas(nome_fantasia, razao_social)").in("id", ids),
    s.supabase.from("categorias_documento").select("codigo, nome"),
  ]);
  const nomesCat = new Map((categorias ?? []).map((c) => [c.codigo, c.nome]));
  const { ip, userAgent } = await dadosRequisicao();

  const itens: { caminho: string; nome: string }[] = [];
  const negados: string[] = [];
  let total = 0;
  const empresas = new Set((docs ?? []).map((d) => d.empresa_id));
  for (const d of docs ?? []) {
    if (total + (d.tamanho ?? 0) > MAX_BYTES) {
      negados.push(`${d.nome_original} (limite de 1 GB por download atingido)`);
      continue;
    }
    const { data, error } = await s.supabase.rpc("registrar_acesso_documento", {
      p_documento_id: d.id,
      p_tipo: "download_lote",
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    });
    if (error || !data) {
      negados.push(`${d.nome_original} (${error?.message ?? "indisponível"})`);
      continue;
    }
    total += d.tamanho ?? 0;
    const emp = d.empresa as { nome_fantasia: string | null; razao_social: string } | null;
    const pasta = [empresas.size > 1 ? seguro(emp?.nome_fantasia ?? emp?.razao_social ?? "empresa") : null, d.competencia.slice(0, 7), seguro(nomesCat.get(d.categoria_codigo) ?? d.categoria_codigo)]
      .filter(Boolean)
      .join("/");
    itens.push({ caminho: (data as unknown as { storage_path: string }).storage_path, nome: `${pasta}/${seguro(d.nome_original)}` });
  }
  if (!itens.length) return new NextResponse(`Nenhum documento disponível para download.\n${negados.join("\n")}`, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  await s.supabase.rpc("registrar_evento", {
    p_acao: "download_lote",
    p_entidade: "documentos",
    p_detalhes: { quantidade: itens.length, negados: negados.length } as never,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  const supabase = s.supabase;
  const zip = new Zip();
  const corpo = new ReadableStream<Uint8Array>({
    start(controller) {
      zip.ondata = (err, parte, final) => {
        if (err) return controller.error(err);
        controller.enqueue(parte);
        if (final) controller.close();
      };
      (async () => {
        const usados = new Set<string>();
        const falhas = [...negados];
        for (const it of itens) {
          const { data: arquivo, error } = await supabase.storage.from("documentos").download(it.caminho);
          if (error || !arquivo) {
            falhas.push(`${it.nome} (não foi possível ler o arquivo)`);
            continue;
          }
          let nome = it.nome;
          for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = it.nome.replace(/(\.[^./]+)?$/, ` (${n})$1`);
          usados.add(nome.toLowerCase());
          const entrada = /\.(xml|txt|csv|ofx)$/i.test(nome) ? new ZipDeflate(nome, { level: 6 }) : new ZipPassThrough(nome);
          zip.add(entrada);
          entrada.push(new Uint8Array(await arquivo.arrayBuffer()), true);
        }
        if (falhas.length) {
          const aviso = new ZipPassThrough("LEIA-ME - arquivos nao incluidos.txt");
          zip.add(aviso);
          aviso.push(strToU8(`Os arquivos abaixo não foram incluídos:\r\n\r\n${falhas.join("\r\n")}\r\n`), true);
        }
        zip.end();
      })().catch((e) => controller.error(e));
    },
  });

  const agora = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(corpo, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="documentos-${agora}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
