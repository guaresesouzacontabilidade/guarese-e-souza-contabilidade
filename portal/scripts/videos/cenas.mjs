/**
 * Roteiro de cada vídeo de apresentação: o que aparece na tela, a legenda que
 * explica e a conferência que prova que a função funcionou. Tudo com a
 * Padaria Pão Dourado (DEMO) e os usuários fictícios da demonstração.
 */
import { expect } from "@playwright/test";

const cartao = (titulo) => titulo.locator("xpath=ancestor::*[contains(@class,'rounded-2xl')][1]");
const botao = (p, nome) => p.getByRole("button", { name: nome }).filter({ visible: true }).first();
const link = (p, nome) => p.getByRole("link", { name: nome }).filter({ visible: true }).first();
const linhaCom = (p, texto) => p.getByText(texto).first().locator("xpath=ancestor::*[.//button][1]");
const itemPendencia = (p, titulo) => p.locator("li.rounded-xl").filter({ has: p.getByText(titulo, { exact: true }) }).first();
const dialogo = (p) => p.getByRole("alertdialog").or(p.getByRole("dialog")).first();

/** Clica num botão que abre a escolha de arquivo e entrega o arquivo fictício. */
async function escolherArquivo(v, alvo, arquivo) {
  const [seletor] = await Promise.all([v.p.waitForEvent("filechooser"), v.clicar(alvo, { depois: 300 })]);
  await seletor.setFiles(arquivo);
  await v.esperar(900);
}

export const CENAS = [
  {
    id: "01-primeiro-acesso",
    titulo: "Primeiro acesso",
    subtitulo: "Como entrar no portal e o que aparece na tela inicial da sua empresa",
    entrar: false,
    inicio: "/login",
    async rodar(v) {
      const { p } = v;
      await v.legenda("O portal abre no navegador, no computador ou no celular, sem instalar nada.");
      await v.legenda("Você entra com o seu e-mail e a senha que criou pelo convite do escritório.", { ler: false });
      await v.digitar(p.locator('input[name="email"]'), "cliente@demo.guareses.test", { atraso: 45 });
      await v.digitar(p.locator('input[name="senha"]'), process.env.DEMO_SENHA ?? "Demo-Teste-2026!", { atraso: 70 });
      await v.esperar(600);
      await v.clicar(botao(p, "Entrar"), { depois: 300 });
      await p.waitForURL((u) => /^\/(aceite|e\/)/.test(u.pathname), { timeout: 90_000 });
      if (p.url().includes("/aceite")) {
        await p.waitForLoadState("load");
        await v.legenda("No primeiro acesso, o portal mostra os termos de uso e explica como os seus dados são protegidos.");
        const termos = p.getByText("Termos de uso", { exact: true }).first().locator("xpath=ancestor::*[contains(@class,'overflow-y-auto')][1]");
        if (await termos.count()) {
          await termos.evaluate((el) => el.scrollBy({ top: 420, behavior: "smooth" }));
          await v.esperar(1200);
        }
        await v.clicar(p.getByRole("checkbox").first(), { depois: 500 });
        await v.clicar(botao(p, "Concordar e continuar"), { depois: 300 });
      }
      await p.waitForURL(/\/e\/[0-9a-f-]{36}$/, { timeout: 90_000 });
      await p.waitForLoadState("networkidle").catch(() => {});
      await v.conferir("entrou e abriu a visão geral da empresa", () => expect(p.getByRole("heading", { name: "Padaria Pão Dourado (DEMO)" }).first()).toBeVisible({ timeout: 30_000 }));
      await v.esperar(800);
      await v.legenda("Esta é a visão geral da sua empresa: o que importa no mês, numa tela só.");
      const vencendo = p.getByText("Documentos vencendo").first();
      await v.conferir("mostra os documentos vencendo", () => expect(vencendo).toBeVisible());
      await v.destacar(vencendo.locator("xpath=ancestor::*[contains(@class,'rounded')][1]"), 3200);
      await v.legenda("Aqui aparecem certidões, alvarás e o certificado digital que estão vencendo.");
      const previsao = p.getByRole("heading", { name: "Previsão de impostos" });
      await v.rolarAte(previsao, { bloco: "start" });
      await v.destacar(cartao(previsao), 3000);
      await v.legenda("A previsão de impostos do mês aparece aqui assim que os documentos chegam ao escritório.");
      const pend = p.getByRole("heading", { name: "Pendências" });
      await v.destacar(cartao(pend), 3000);
      await v.legenda("As pendências mostram o que o escritório ainda precisa receber para fechar o mês.");
      const docs = p.getByRole("heading", { name: "Documentos do escritório" });
      await v.rolarAte(docs, { bloco: "start" });
      await v.destacar(cartao(docs), 3000);
      await v.legenda("Guias, holerites e recibos que o escritório publica ficam aqui, prontos para baixar.");
      const conversas = p.getByRole("heading", { name: "Conversas com o escritório" });
      await v.rolarAte(conversas);
      await v.destacar(cartao(conversas), 2600);
      await v.legenda("E as conversas com o escritório ficam registradas, sem se perder no WhatsApp.");
      await v.topo();
      await v.moverPara(p.locator('nav[aria-label="Menu principal"]'));
      await v.legenda("No menu ao lado ficam todas as funções. Os próximos vídeos mostram cada uma delas.");
    },
  },
  {
    id: "02-avisos-e-aparencia",
    titulo: "Avisos e aparência",
    subtitulo: "O sininho que avisa tudo o que acontece e as três aparências do portal",
    inicio: (v) => v.empresa,
    async rodar(v) {
      const { p } = v;
      const sino = p.getByRole("button", { name: /^Notificações/ });
      await v.legenda("O sininho mostra os avisos novos: guias publicadas, prazos, respostas do escritório.", { ler: false });
      await v.moverPara(sino);
      await v.esperar(1800);
      await v.clicar(sino, { depois: 1200 });
      await v.conferir("o sininho abre a lista de avisos", () => expect(p.getByText("Marcar todas como lidas")).toBeVisible({ timeout: 20_000 }));
      await v.legenda("Os mesmos avisos também chegam por e-mail. Se quiser, o portal avisa no celular.");
      await v.clicar(botao(p, "Marcar todas como lidas"), { depois: 1200 });
      await v.conferir("marcar todas como lidas zera o contador", () => expect(p.getByRole("button", { name: "Notificações" })).toBeVisible({ timeout: 20_000 }));
      await p.keyboard.press("Escape");
      await v.esperar(700);
      const aparencia = p.getByRole("button", { name: /Aparência do portal/ });
      await v.legenda("O portal tem três aparências. Cada pessoa escolhe a que achar mais confortável.", { ler: false });
      await v.moverPara(aparencia);
      await v.esperar(1500);
      for (const [opcao, classe, texto] of [
        ["Escura (Aurora)", "dark", "A escura, Aurora, descansa a vista à noite."],
        ["Bronze", "bronze", "A Bronze tem tons quentes, de cobre."],
        ["Clara (Luz)", "light", "E a clara, Luz, é a padrão para o dia a dia."],
      ]) {
        await v.clicar(aparencia, { depois: 700 });
        await v.clicar(p.getByRole("menuitemradio", { name: opcao }).or(p.getByRole("menuitem", { name: opcao })).first(), { depois: 900 });
        await v.conferir(`aparência ${opcao} aplicada`, () => expect(p.locator("html")).toHaveClass(new RegExp(`\\b${classe}\\b`)));
        await v.legenda(texto);
      }
    },
  },
  {
    id: "03-enviar-documentos",
    titulo: "Enviar documentos",
    subtitulo: "Como mandar os documentos do mês para o escritório pelo computador",
    inicio: (v) => `${v.empresa}/enviar`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Para enviar, primeiro escolha o mês a que o documento se refere: a competência.", { ler: false });
      await v.destacar(p.locator("#competencia"), 2600);
      await v.esperar(1200);
      await v.legenda("Depois, o tipo. Para XML, extrato OFX e arquivos de nome claro, como “comprovante PIX”, o portal identifica sozinho.", { ler: false });
      await v.escolher(p.locator("#categoria"), "compras_vendas_despesas");
      await v.esperar(1500);
      await v.legenda("Agora é só escolher os arquivos. Pode ser PDF, foto, planilha, XML ou um ZIP.", { ler: false });
      await escolherArquivo(v, botao(p, "Escolher arquivos"), v.arquivos.recibo);
      const lista = p.getByRole("list", { name: "Arquivos selecionados" });
      await v.conferir("o arquivo escolhido aparece na lista", () => expect(lista).toContainText("Recibo de aluguel"));
      await v.rolarAte(lista);
      await v.destacar(lista, 3000);
      await v.legenda("O arquivo entra na lista com o tipo e o mês. Dá para mandar vários de uma vez.");
      await v.digitar(p.locator("#observacao"), "Recibo do aluguel de setembro.", { atraso: 45 });
      await v.clicar(botao(p, /^Enviar 1 arquivo/), { depois: 400 });
      await v.conferir("o envio é confirmado na hora", () => expect(p.getByText(/documento\(s\) recebido\(s\)/).first()).toBeVisible({ timeout: 60_000 }));
      await v.legenda("Pronto: a confirmação de recebimento aparece na hora, e o escritório é avisado.");
      await v.clicar(link(p, "Meus documentos"), { depois: 1200 });
      await p.waitForURL(/\/documentos/);
      const linha = p.getByText("Recibo de aluguel - setembro 2026 (DEMO).pdf").first();
      await v.conferir("o documento aparece em Meus documentos", () => expect(linha).toBeVisible({ timeout: 30_000 }));
      await v.destacar(linha.locator("xpath=ancestor::*[self::li or self::tr][1]"), 3000);
      await v.legenda("Em “Meus documentos” você acompanha cada envio, até a conferência do escritório.");
    },
  },
  {
    id: "04-enviar-pelo-celular",
    titulo: "Enviar pelo celular",
    subtitulo: "Fotografe o documento e envie na hora",
    celular: true,
    inicio: (v) => v.empresa,
    async rodar(v) {
      const { p } = v;
      await v.legenda("No celular, a tela se ajusta e os atalhos ficam na parte de baixo.");
      await v.clicar(p.locator('nav[aria-label="Atalhos"]').getByRole("link", { name: "Enviar" }), { depois: 1200 });
      await p.waitForURL(/\/enviar/);
      await v.legenda("Toque em “Tirar foto” e a câmera do celular abre.", { ler: false });
      await v.esperar(1600);
      await escolherArquivo(v, botao(p, "Tirar foto"), v.arquivos.fotoCupom);
      const lista = p.getByRole("list", { name: "Arquivos selecionados" });
      await v.conferir("a foto entra na lista de envio", () => expect(lista).toContainText(/foto-\d{8}/));
      await v.rolarAte(lista);
      await v.legenda("A foto entra na lista, já com o mês. Escolha o tipo de documento e envie.", { ler: false });
      const tipo = lista.locator('select[aria-label^="Tipo de documento de"]').first();
      await tipo.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await v.esperar(900);
      await tipo.selectOption("compras_vendas_despesas");
      await v.esperar(1600);
      await v.clicar(botao(p, /^Enviar 1 arquivo/), { depois: 400 });
      await v.conferir("a foto é recebida pelo escritório", () => expect(p.getByText(/documento\(s\) recebido\(s\)/).first()).toBeVisible({ timeout: 60_000 }));
      await v.legenda("Recebido! O cupom já está com o escritório, sem precisar escanear nada.");
    },
  },
  {
    id: "05-pendencias-do-mes",
    titulo: "Pendências do mês",
    subtitulo: "O que o escritório ainda precisa receber, com prazo e situação de cada item",
    inicio: (v) => `${v.empresa}/pendencias`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Aqui está a lista do que o escritório precisa para fechar o mês, com o prazo de cada item.");
      const resumo = p.getByText("Faltantes", { exact: true }).first().locator("xpath=ancestor::*[contains(@class,'grid')][1]");
      await v.destacar(resumo, 3200);
      await v.legenda("Os números mostram o que falta, o que está atrasado, o que precisa de correção e o que já foi concluído.");
      const corrigir = itemPendencia(p, "Comprovantes de pagamentos e recebimentos");
      await v.rolarAte(corrigir);
      await v.destacar(corrigir, 3000);
      await v.legenda("Quando o escritório pede uma correção, o item fica marcado e você recebe um aviso.");
      await v.clicar(corrigir.getByRole("button", { name: /documento\(s\) enviado\(s\)/ }), { depois: 1000 });
      const marcado = corrigir.locator("ul li").filter({ hasText: /correção/i }).getByRole("link").first();
      await v.legenda("No histórico aparece qual arquivo precisa ser corrigido. Toque nele.", { ler: false });
      await v.esperar(1500);
      await v.clicar(marcado, { depois: 1500 });
      await p.waitForURL(/\/documentos\/[0-9a-f-]{36}/);
      await v.legenda("O escritório explica o que precisa ser corrigido. É só substituir o arquivo.");
      await v.clicar(botao(p, "Substituir arquivo"), { depois: 900 });
      const d = dialogo(p);
      await d.locator("#sub-arquivo").setInputFiles(v.arquivos.comprovantePix);
      await v.esperar(900);
      await v.digitar(d.locator("#sub-motivo"), "Segue o comprovante completo, com o recebedor.", { atraso: 32 });
      await v.clicar(d.getByRole("button", { name: "Enviar nova versão" }), { depois: 400 });
      await v.conferir("a nova versão é recebida", () => expect(p.getByText(/Nova versão recebida/).first()).toBeVisible({ timeout: 60_000 }));
      await v.legenda("A versão anterior fica guardada no histórico e a nova volta para a conferência do escritório.");
      await v.ir(`${v.empresa}/pendencias`);
      const item = itemPendencia(p, "Comprovantes de pagamentos e recebimentos");
      await v.rolarAte(item);
      await v.conferir("a pendência passa para enviado/aguardando conferência", () => expect(item).toContainText(/Enviado|aguardando conferência|Em análise/, { timeout: 30_000 }));
      await v.destacar(item, 3000);
      await v.legenda("A pendência agora aparece como enviada. O escritório confere e conclui o item.");
      const opcional = itemPendencia(p, "Eventos fiscais (cancelamentos e cartas de correção)");
      await v.rolarAte(opcional);
      await v.legenda("Se algo não aconteceu no mês, toque em “Não se aplica” e explique.", { ler: false });
      await v.clicar(opcional.getByRole("button", { name: "Não se aplica" }), { depois: 900 });
      const dna = dialogo(p);
      await v.digitar(dna.locator("textarea"), "Não houve cancelamento nem carta de correção em setembro.", { atraso: 35 });
      await v.clicar(dna.getByRole("button", { name: "Enviar para revisão" }), { depois: 1500 });
      await v.conferir("o “não se aplica” vai para a revisão do escritório", () => expect(opcional).toContainText(/revisão|Não se aplica/i, { timeout: 30_000 }));
      await v.legenda("O pedido vai para o escritório revisar. Nada fica esquecido.");
    },
  },
  {
    id: "06-documentos-do-escritorio",
    titulo: "Documentos do escritório",
    subtitulo: "Guias, holerites, recibos e relatórios que o escritório publica para a sua empresa",
    inicio: (v) => `${v.empresa}/documentos`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Em “Meus documentos” ficam os arquivos que você enviou e os que o escritório publicou.");
      await v.clicar(link(p, "Do escritório para a empresa").or(botao(p, "Do escritório para a empresa")).first(), { depois: 1400 });
      await v.conferir("a aba do escritório lista os documentos publicados", () => expect(p.getByText(/Folha de pagamento e holerites/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("Guias de impostos, folha de pagamento, holerites e recibos de entrega das declarações.");
      const folha = p.getByText(/Folha de pagamento e holerites/).first();
      await v.destacar(folha.locator("xpath=ancestor::*[self::li or self::tr][1]"), 2600);
      await v.clicar(folha, { depois: 1500 });
      await v.legenda("Cada documento tem a sua página, com o histórico e o botão para baixar.", { ler: false });
      await v.esperar(2400);
      const baixar = link(p, /^Baixar/).or(botao(p, /^Baixar/)).first();
      await v.moverPara(baixar);
      const [download] = await Promise.all([p.waitForEvent("download", { timeout: 30_000 }), baixar.click()]);
      await v.conferir("o documento é baixado", async () => expect(await download.suggestedFilename()).toBeTruthy());
      await v.legenda("O download começa na hora. Os arquivos ficam guardados no portal, com segurança.");
    },
  },
  {
    id: "07-agenda-de-pagamentos",
    titulo: "Agenda de pagamentos",
    subtitulo: "As guias do mês com vencimento e valor, e o “Paguei” com comprovante",
    inicio: (v) => `${v.empresa}/agenda`,
    async preparar(v) {
      // Deixa a guia do DAS em aberto para o vídeo mostrar o "Paguei"
      const c = await v.abrirSemGravar("cliente");
      await c.goto(`${c.url().match(/^https?:\/\/[^/]+/)[0]}${v.empresa}/agenda`);
      const das = linhaCom(c, "DAS — Simples Nacional — 09/2026");
      await das.waitFor({ timeout: 30_000 });
      if (await das.getByRole("button", { name: "Desfazer" }).isVisible().catch(() => false)) {
        await das.getByRole("button", { name: "Desfazer" }).click();
        await expect(c.getByText("Pagamento desfeito.")).toBeVisible({ timeout: 30_000 });
      }
    },
    async rodar(v) {
      const { p } = v;
      await v.legenda("A agenda mostra as guias do mês publicadas pelo escritório: vencimento, valor e situação.");
      const das = linhaCom(p, "DAS — Simples Nacional — 09/2026");
      await v.destacar(das, 3000);
      await v.legenda("Dá para baixar a guia aqui mesmo. Depois de pagar, toque em “Paguei”.", { ler: false });
      await v.moverPara(das.getByRole("link", { name: /Guia/ }).or(das.getByRole("button", { name: /Guia/ })).first());
      await v.esperar(2200);
      await v.clicar(das.getByRole("button", { name: "Paguei" }), { depois: 900 });
      const dpg = dialogo(p);
      await v.legenda("Informe a data do pagamento e anexe o comprovante.", { ler: false });
      await v.destacar(dpg.locator("#pg-data"), 2000);
      await dpg.locator("#pg-arquivo").setInputFiles(v.arquivos.comprovante);
      await v.esperar(1500);
      await v.clicar(dpg.getByRole("button", { name: "Confirmar pagamento" }), { depois: 400 });
      await v.conferir("o pagamento é registrado", () => expect(p.getByText(/Pagamento informado/).first()).toBeVisible({ timeout: 60_000 }));
      await v.conferir("a guia fica como paga, com comprovante", () => expect(das).toContainText(/Pago em/));
      await v.destacar(das, 3000);
      await v.legenda("A guia fica como paga, com o comprovante guardado. O escritório vê na hora.");
    },
  },
  {
    id: "08-vencimentos",
    titulo: "Vencimentos",
    subtitulo: "Certificado digital, alvarás, licenças e certidões, com aviso antes de vencer",
    inicio: (v) => `${v.empresa}/vencimentos`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Aqui ficam os documentos da empresa que têm validade: certidões, alvarás, licenças e o certificado digital.");
      await v.legenda("O portal avisa antes de vencer e mostra quem cuida da renovação: a empresa ou o escritório.");
      await v.legenda("Você também pode cadastrar um vencimento novo.", { ler: false });
      await v.clicar(botao(p, "Novo vencimento"), { depois: 900 });
      const d = dialogo(p);
      await v.escolher(d.locator("#vc-tipo"), "licenca_bombeiros");
      await v.digitar(d.locator("#vc-desc"), "Vistoria do Corpo de Bombeiros 2026", { atraso: 35 });
      await d.locator("#vc-validade").fill("2027-03-31");
      await v.esperar(600);
      await v.escolher(d.locator("#vc-resp"), "cliente");
      await v.digitar(d.locator("#vc-orgao"), "Corpo de Bombeiros Militar do Tocantins", { atraso: 30 });
      await v.clicar(d.getByRole("button", { name: "Cadastrar" }), { depois: 1500 });
      const novo = p.getByText("Vistoria do Corpo de Bombeiros 2026").first();
      await v.conferir("o novo vencimento aparece na lista", () => expect(novo).toBeVisible({ timeout: 30_000 }));
      await v.rolarAte(novo);
      await v.destacar(novo.locator("xpath=ancestor::*[self::li or self::tr][1]"), 3000);
      await v.legenda("Pronto. Quando a data se aproximar, você e o escritório recebem o aviso.");
    },
  },
  {
    id: "09-mensagens",
    titulo: "Mensagens com o escritório",
    subtitulo: "Converse com a equipe e veja a resposta chegar na hora, sem atualizar a página",
    inicio: (v) => `${v.empresa}/mensagens`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("As conversas ficam separadas por assunto. Dá para ver as abertas e as resolvidas.");
      const conversa = p.getByRole("link", { name: /Guia do DAS de 09\/2026/ }).first();
      await v.destacar(conversa, 2400);
      await v.clicar(conversa, { depois: 1500 });
      await p.waitForURL(/\/mensagens\/[0-9a-f-]{36}/);
      const url = p.url();
      await v.legenda("O escritório perguntou sobre a guia do DAS. Vamos responder.", { ler: false });
      await v.esperar(1800);
      await v.digitar(p.getByLabel("Sua resposta"), "Olá! A guia do DAS já foi paga. Mandei o comprovante pela agenda.", { atraso: 32 });
      await v.clicar(botao(p, "Enviar"), { depois: 1200 });
      await v.conferir("a mensagem do cliente aparece na conversa", () => expect(p.getByText("Olá! A guia do DAS já foi paga.", { exact: false }).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("A equipe do escritório recebe o aviso e responde…", { ler: false });
      const equipe = await v.abrirSemGravar("contador");
      await equipe.goto(url);
      await equipe.getByLabel("Sua resposta").fill("Recebemos, obrigado! O comprovante já está conferido.");
      await equipe.getByRole("button", { name: "Enviar" }).click();
      await v.conferir("a resposta do escritório chega sem atualizar a página", () => expect(p.getByText("Recebemos, obrigado! O comprovante já está conferido.")).toBeVisible({ timeout: 20_000 }));
      await v.esperar(600);
      await v.legenda("…e a resposta aparece na hora, sem precisar atualizar a página. Fica tudo registrado.");
    },
  },
  {
    id: "10-solicitacoes",
    titulo: "Solicitações de serviço",
    subtitulo: "Peça um serviço ao escritório e acompanhe cada etapa",
    inicio: (v) => `${v.empresa}/solicitacoes`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Precisa de algo? Admissão, férias, alteração do contrato, certidões… Peça por aqui.");
      await v.clicar(link(p, "Nova solicitação").or(botao(p, "Nova solicitação")).first(), { depois: 1300 });
      await v.clicar(p.getByText("Férias de empregado", { exact: true }), { depois: 1200 });
      await v.legenda("O portal já mostra o que costuma ser preciso para esse serviço.");
      await v.digitar(p.locator("#sol-titulo"), "Férias do padeiro em novembro", { atraso: 40 });
      await v.digitar(p.locator("#sol-desc"), "O padeiro João Exemplo vai tirar 30 dias de férias a partir de 03/11.", { atraso: 28 });
      await v.clicar(botao(p, "Abrir solicitação"), { depois: 1500 });
      await v.conferir("a solicitação é aberta", () => expect(p.getByText("Solicitação aberta").first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("A solicitação foi aberta. O escritório é avisado e você acompanha cada passo.");
      await v.ir(`${v.empresa}/solicitacoes`);
      await v.clicar(p.getByRole("link", { name: /Mudança de endereço da padaria/ }).first(), { depois: 1500 });
      await v.legenda("Nesta outra, o escritório pediu documentos. O pedido aparece no histórico.");
      await v.clicar(p.getByRole("button", { name: "Já enviei o que foi pedido" }), { depois: 800 });
      await v.digitar(p.locator("#cli-com"), "Enviei o contrato de locação e o IPTU em Enviar documentos.", { atraso: 30 });
      await v.clicar(botao(p, "Avisar o escritório"), { depois: 1500 });
      await v.conferir("o escritório é avisado da resposta", () => expect(p.getByText(/Solicitação atualizada|Em andamento/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("Pronto: a solicitação volta para o escritório, com a sua resposta registrada.");
    },
  },
  {
    id: "11-financeiro",
    titulo: "Financeiro",
    subtitulo: "Saldo das contas, o que entra e o que sai, e o cadastro de uma conta a pagar",
    inicio: (v) => `${v.empresa}/financeiro`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("O financeiro mostra o saldo de hoje, o que está para receber e o que está para pagar.");
      const saldos = p.getByRole("heading", { name: "Saldos por conta" });
      await v.rolarAte(saldos);
      await v.legenda("Os saldos ficam separados por conta, e os próximos 30 dias mostram o que vem pela frente.");
      await v.topo();
      await v.legenda("Vamos cadastrar uma conta a pagar.", { ler: false });
      await v.clicar(link(p, "Novo lançamento").or(botao(p, "Novo lançamento")).first(), { depois: 1300 });
      await v.clicar(p.getByText("Conta a pagar (saída)"), { depois: 500 });
      await v.digitar(p.locator("#l-desc"), "Conta de energia — outubro (DEMO)", { atraso: 35 });
      await v.escolher(p.locator("#l-cat"), { label: "4.05 Energia, água, telefone e internet" });
      await p.locator("#l-comp").fill("2026-10-01");
      await v.esperar(400);
      await p.locator("#l-venc").fill("2026-10-27");
      await v.esperar(400);
      await v.digitar(p.locator("#l-valor"), "486,90", { atraso: 60 });
      await v.clicar(botao(p, "Salvar lançamento"), { depois: 1800 });
      await v.conferir("o lançamento é salvo", () => expect(p.getByText("Conta de energia — outubro (DEMO)").first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("Salvo. A conta entra na agenda do financeiro e nos relatórios da empresa.");
    },
  },
  {
    id: "12-relatorios",
    titulo: "Relatórios",
    subtitulo: "Saúde financeira, resultado do mês e fluxo de caixa, em PDF ou Excel",
    inicio: (v) => `${v.empresa}/relatorios`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Os relatórios mostram a saúde financeira da empresa, com gráficos fáceis de ler.");
      await v.conferir("o painel de saúde financeira abre com indicadores", () => expect(p.getByRole("heading", { name: "Indicadores de saúde" })).toBeVisible({ timeout: 30_000 }));
      await v.rolar(560, { passos: 2 });
      await v.legenda("Receitas, custos, resultado e para onde está indo o dinheiro, mês a mês.");
      await v.rolar(560, { passos: 2 });
      await v.legenda("Dá para escolher o período: um mês, um trimestre, o ano ou de um mês até outro.", { ler: false });
      await v.topo();
      const periodo = p.locator("#periodo");
      const trimestre = await periodo.locator("option", { hasText: /trimestre/i }).first().getAttribute("value");
      await v.escolher(periodo, trimestre);
      await p.waitForLoadState("networkidle").catch(() => {});
      await v.esperar(1500);
      await v.clicar(link(p, "Resultado (DRE)"), { depois: 1800 });
      await v.conferir("a DRE abre", () => expect(p.getByText(/Receita/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("O resultado (DRE) mostra se a empresa teve lucro ou prejuízo no período.");
      await v.clicar(link(p, "Fluxo de caixa"), { depois: 1800 });
      await v.legenda("O fluxo de caixa mostra o dinheiro que entrou e saiu de verdade.");
      const pdf = link(p, /^PDF/).or(botao(p, /^PDF/)).first();
      await v.moverPara(pdf);
      const [download] = await Promise.all([p.waitForEvent("download", { timeout: 60_000 }), pdf.click()]);
      await v.conferir("o relatório é baixado em PDF", async () => expect(await download.suggestedFilename()).toMatch(/\.pdf$/i));
      await v.legenda("E qualquer relatório pode ser baixado em PDF ou Excel, para levar ao banco, por exemplo.");
    },
  },
  {
    id: "13-declaracao-de-faturamento",
    titulo: "Declaração de faturamento",
    subtitulo: "O escritório emite, você baixa, assina e devolve pelo portal",
    inicio: (v) => `${v.empresa}/declaracoes`,
    async preparar(v) {
      const e = await v.abrirSemGravar("contador");
      const base = e.url().match(/^https?:\/\/[^/]+/)[0];
      await e.goto(`${base}${v.empresa}/declaracoes`);
      if (await e.getByRole("link", { name: "PDF para assinar" }).count()) return;
      await e.getByRole("link", { name: "Nova declaração de faturamento" }).click();
      await expect(e.getByRole("heading", { name: "Nova declaração de faturamento" })).toBeVisible({ timeout: 30_000 });
      await e.fill("#dec-rep-nome", "MARIA EXEMPLO (FICTÍCIA)");
      await e.fill("#dec-rep-cpf", "529.982.247-25");
      await e.fill("#dec-cont-nome", "CONTADORA EXEMPLO (FICTÍCIA)");
      await e.fill("#dec-cont-crc", "TO-000000/O-0");
      await e.fill("#dec-finalidade", "comprovação de faturamento junto a instituição financeira");
      await e.getByRole("button", { name: "Emitir declaração" }).click();
      await expect(e.getByText("Declaração emitida", { exact: true })).toBeVisible({ timeout: 60_000 });
    },
    async rodar(v) {
      const { p } = v;
      await v.legenda("Quando você pede uma declaração de faturamento, o escritório emite e ela aparece aqui.");
      const pdf = link(p, "PDF para assinar");
      await v.conferir("a declaração emitida aparece para o cliente", () => expect(pdf).toBeVisible({ timeout: 30_000 }));
      await v.destacar(pdf.locator("xpath=ancestor::*[self::li or self::tr or contains(@class,'rounded-2xl')][1]"), 3000);
      await v.legenda("Baixe o PDF, com os 12 meses de faturamento e as logos da empresa e do escritório.", { ler: false });
      await v.moverPara(pdf);
      const [download] = await Promise.all([p.waitForEvent("download", { timeout: 60_000 }), pdf.click()]);
      await v.conferir("o PDF da declaração é baixado", async () => expect(await download.suggestedFilename()).toMatch(/\.pdf$/i));
      await v.esperar(1500);
      const como = p.getByRole("heading", { name: "Como assinar" });
      if (await como.count()) {
        await v.rolarAte(como);
        await v.legenda("O portal explica como assinar: pelo gov.br, com certificado digital ou à mão.");
        await v.topo();
      }
      await v.legenda("Depois de assinar, devolva a via assinada pelo próprio portal.", { ler: false });
      await v.clicar(botao(p, "Enviar a assinada"), { depois: 900 });
      await p.setInputFiles('input[name="arquivo"]', v.arquivos.declaracaoAssinada);
      await v.esperar(900);
      await v.clicar(dialogo(p).getByRole("button", { name: "Enviar" }), { depois: 1500 });
      await v.conferir("a via assinada é guardada", () => expect(p.getByText(/Declaração assinada guardada/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("A via assinada fica guardada junto com a declaração, pronta para o escritório e para o banco.");
    },
  },
  {
    id: "14-economia-de-impostos",
    titulo: "Economia de impostos",
    subtitulo: "O escritório confere as suas notas e mostra o que pode voltar para o caixa",
    inicio: (v) => `${v.empresa}/auditor-fiscal`,
    async preparar(v) {
      const e = await v.abrirSemGravar("contador");
      const base = e.url().match(/^https?:\/\/[^/]+/)[0];
      await e.goto(`${base}${v.empresa}/auditor-fiscal`);
      // Logo depois de criar a demonstração a análise ainda pode estar na fila
      if (!(await e.locator("[data-achado]").first().isVisible().catch(() => false))) {
        await e.getByRole("button", { name: "Analisar agora" }).click();
        await expect(e.locator("[data-achado]").first()).toBeVisible({ timeout: 180_000 });
      }
      for (const regra of ["monofasico_simples", "st_simples"]) {
        await e.goto(`${base}${v.empresa}/auditor-fiscal`);
        const card = e.locator(`[data-achado="${regra}"]`).filter({ has: e.getByRole("button", { name: "Publicar ao cliente" }) }).first();
        if (!(await card.isVisible().catch(() => false))) continue;
        await card.getByRole("button", { name: "Publicar ao cliente" }).click();
        await dialogo(e).getByRole("button", { name: "Publicar" }).click();
        await expect(e.getByText(/Publicado ao cliente/)).toBeVisible({ timeout: 30_000 });
      }
    },
    async rodar(v) {
      const { p } = v;
      await v.legenda("O escritório confere as notas de compra e de venda da empresa em busca de imposto pago a mais.");
      const caixa = p.getByText("Pode voltar para o caixa", { exact: false }).first();
      await v.conferir("o valor que pode voltar para o caixa aparece", () => expect(caixa).toBeVisible({ timeout: 30_000 }));
      await v.destacar(caixa.locator("xpath=ancestor::*[contains(@class,'rounded-2xl')][1]"), 3000);
      await v.legenda("Quando encontra algo, mostra aqui quanto pode voltar para o caixa. É uma estimativa, que o escritório confirma.");
      const pedir = botao(p, "Quero que o escritório cuide disso");
      await v.rolarAte(pedir);
      await v.legenda("Cada caso vem explicado em linguagem simples, com o mês e o valor.");
      await v.legenda("Se quiser, é só pedir: o escritório cuida da recuperação.", { ler: false });
      await v.clicar(pedir, { depois: 900 });
      await v.clicar(dialogo(p).getByRole("button", { name: "Enviar pedido" }), { depois: 1800 });
      await v.conferir("o pedido de recuperação é enviado ao escritório", () => expect(p.getByText(/pedido|Solicitação/i).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("O pedido vira uma solicitação, e você acompanha tudo por lá.");
    },
  },
  {
    id: "15-previsao-de-impostos",
    titulo: "Previsão de impostos",
    subtitulo: "Quanto a empresa deve pagar no mês, antes de a guia chegar",
    inicio: (v) => `${v.empresa}/calculos`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Os cálculos mostram a previsão dos impostos do mês, feita com os documentos que você enviou.");
      await v.legenda("Setembro ainda espera alguns documentos. Vamos ver a previsão de agosto, que já está completa.", { ler: false });
      await v.clicar(link(p, /Ver a previsão de agosto/), { depois: 2000 });
      await v.conferir("a previsão do mês aparece com valores", () => expect(p.getByText(/R\$\s?\d/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("Aqui está a estimativa de cada imposto, com a data de vencimento.");
      await v.rolar(480, { passos: 2 });
      await v.legenda("Assim você se planeja antes de a guia chegar, sem susto no fim do mês.");
      await v.topo();
      await v.clicar(link(p, "Colaboradores"), { depois: 1800 });
      await v.legenda("Em colaboradores fica a lista dos funcionários, e há também a simulação de rescisão.");
    },
  },
  {
    id: "16-maquininhas",
    titulo: "Maquininhas de cartão",
    subtitulo: "Confira se as taxas cobradas batem com o contrato",
    inicio: (v) => `${v.empresa}/maquininhas`,
    async rodar(v) {
      const { p } = v;
      await v.legenda("Você envia o relatório de vendas da maquininha e o portal confere as taxas de cada venda.");
      const acima = p.getByRole("heading", { name: "Vendas com taxa acima do contrato" });
      await v.conferir("o portal mostra as vendas com taxa acima do contrato", () => expect(acima).toBeVisible({ timeout: 30_000 }));
      await v.rolarAte(acima);
      await v.destacar(cartao(acima), 3200);
      await v.legenda("Quando a taxa cobrada passa da combinada, a venda aparece aqui, com a diferença em reais.");
      await v.legenda("Com isso, você tem a prova para pedir o dinheiro de volta à operadora.");
      await v.topo();
      await v.clicar(link(p, "Contratos e taxas"), { depois: 1800 });
      await v.legenda("As taxas combinadas de cada maquininha ficam cadastradas aqui, para a comparação.");
    },
  },
  {
    id: "17-notas-fiscais",
    titulo: "Notas fiscais",
    subtitulo: "Notas de compra que chegam sozinhas e emissão de notas pelo portal",
    inicio: (v) => `${v.empresa}/notas-automaticas`,
    async rodar(v) {
      const { p } = v;
      await v.conferir("a tela mostra que a busca automática está desconectada", () => expect(p.getByText("Desconectada").first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("As notas automáticas buscam na SEFAZ as notas emitidas contra a sua empresa, sem você enviar nada.");
      await v.legenda("Na demonstração ela aparece desconectada: a busca liga depois que o certificado digital da empresa é cadastrado.");
      await v.clicar(link(p, "Emitir nota de serviço"), { depois: 1800 });
      await v.conferir("a emissão de nota de serviço mostra a situação real (desconectada)", () => expect(p.getByText("Emissão desconectada")).toBeVisible({ timeout: 30_000 }));
      await v.legenda("A nota de serviço também sai pelo portal, pelo Emissor Nacional, depois que o escritório liga a emissão.");
      await v.clicar(link(p, "Emitir nota de produto"), { depois: 1800 });
      await v.legenda("O mesmo vale para a nota de produto. O escritório configura e você emite sem sair do portal.");
    },
  },
  {
    id: "18-conta-e-seguranca",
    titulo: "Sua conta e segurança",
    subtitulo: "Senha, verificação em duas etapas, quem acessa a empresa e os seus dados",
    inicio: "/conta",
    async rodar(v) {
      const { p } = v;
      await v.legenda("Em “Minha conta” você troca a senha e ativa a verificação em duas etapas, que deixa o acesso mais seguro.");
      const duas = p.getByRole("heading", { name: "Verificação em duas etapas" });
      await v.rolarAte(duas);
      await v.destacar(cartao(duas), 3000);
      const disp = p.getByRole("heading", { name: "Dispositivos conectados" });
      await v.rolarAte(disp);
      await v.destacar(cartao(disp), 2800);
      await v.legenda("Dá para ver em quais aparelhos a conta está aberta e sair de todos de uma vez.");
      const lgpd = p.getByRole("heading", { name: /Privacidade e seus dados/ });
      await v.rolarAte(lgpd);
      await v.legenda("E, pela LGPD, você pode baixar os seus dados a qualquer momento.", { ler: false });
      const baixar = botao(p, /Baixar meus dados/).or(link(p, /Baixar meus dados/)).first();
      await v.moverPara(baixar);
      const [download] = await Promise.all([p.waitForEvent("download", { timeout: 60_000 }), baixar.click()]);
      await v.conferir("os dados pessoais são baixados", async () => expect(await download.suggestedFilename()).toMatch(/\.json$/i));
      await v.esperar(1200);
      await v.ir(`${v.empresa}/configuracoes?aba=usuarios`);
      await v.legenda("O empresário também decide quem da empresa usa o portal, e o que cada pessoa pode ver.", { ler: false });
      await v.clicar(botao(p, /^Convidar/), { depois: 900 });
      const d = dialogo(p);
      await v.digitar(d.locator("#convite-nome"), "Ana Exemplo (fictícia)", { atraso: 35 });
      await v.digitar(d.locator("#convite-email"), "ana.exemplo@demo.guareses.test", { atraso: 30 });
      if (await d.locator("#convite-papel").count()) await v.escolher(d.locator("#convite-papel"), "cliente_colaborador");
      await v.legenda("Uma colaboradora pode, por exemplo, só enviar documentos, sem ver o financeiro.");
      await v.clicar(d.getByRole("button", { name: "Enviar convite" }), { depois: 1800 });
      await v.conferir("o convite é registrado", () => expect(p.getByText(/Convite registrado|Convite enviado|ana\.exemplo@demo\.guareses\.test/).first()).toBeVisible({ timeout: 30_000 }));
      await v.legenda("Ela recebe um convite por e-mail e cria a própria senha. O portal nunca guarda senhas.");
    },
  },
];
