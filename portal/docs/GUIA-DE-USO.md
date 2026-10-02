# Guia de uso do Portal Guarese's ON

Manual prático para a equipe do escritório e para os clientes. Os nomes em **negrito** são os que aparecem nos menus e botões do portal.

---

## 1. Primeiro acesso (todos)

1. A pessoa recebe um **convite** (por e-mail ou por um link enviado pelo escritório). O portal não tem cadastro aberto: só entra quem foi convidado.
2. Ao abrir o link, cria a própria senha (mínimo de 10 caracteres, com letras maiúsculas, minúsculas e números).
3. Lê e aceita os **Termos de uso** e a **Política de privacidade**.
4. Recomendado: em **Minha conta → Verificação em duas etapas → Ativar agora**, cadastrar um aplicativo autenticador (Google Authenticator ou Microsoft Authenticator). A partir daí, cada novo acesso pede a senha e um código de 6 números do aplicativo.

Esqueceu a senha? Na tela de entrada, use **Esqueci minha senha**.

### Minha conta

No canto superior direito (iniciais do nome) → **Minha conta**:

- **Seus dados**: nome e telefone (o e-mail só o escritório altera).
- **Verificação em duas etapas**: ativar ou desativar.
- **Avisos**: no sino do portal eles sempre aparecem, na hora. Aqui você pode **ativar os avisos no celular ou no computador** (chegam mesmo com o portal fechado), enviar um **aviso de teste** e escolher o que também chega por e-mail. Clientes podem ainda **receber avisos por WhatsApp** (novos documentos, mensagens e solicitações do escritório) no número informado em “Seus dados”, quando o escritório tiver ativado o WhatsApp. A equipe do escritório escolhe de quais empresas quer ser avisada quando um cliente enviar arquivos (veja a seção 3).
- **Trocar senha**: ao trocar, os outros aparelhos conectados precisam entrar de novo.
- **Dispositivos conectados**: onde a conta está aberta; dá para encerrar um aparelho ou todos os outros.
- **Privacidade e seus dados (LGPD)**: baixar uma cópia dos seus dados e fazer pedidos ao escritório (correção, exclusão etc.).

---

## 2. Para os clientes

Depois de entrar, aparece a área da sua empresa. Se você tiver acesso a mais de uma, troque no seletor de empresa no topo da tela.

### Visão geral
Resumo do mês: documentos que faltam, prazos, avisos do escritório e, quando liberado, a saúde financeira.

### Enviar documentos
1. Escolha o **tipo de documento** (ex.: XML de notas de saída, extrato bancário, folha de ponto) e o **mês de referência**.
2. Arraste os arquivos ou clique para escolher. Aceita PDF, fotos, XML, planilhas e ZIP (vários XML de uma vez).
3. Clique em **Enviar documentos**. O documento aparece como **Recebido** e o escritório é avisado.

Dica: fotos de comprovantes funcionam — o escritório usa leitura automática e confere tudo.

### Pendências
O **checklist do mês** mostra o que a empresa precisa enviar e o prazo de cada item:

| Situação | Significado |
| --- | --- |
| Faltante | ainda não enviado |
| Enviado — aguardando conferência | o escritório vai conferir |
| Em análise | em conferência |
| Precisa de correção | o escritório explicou o que ajustar; envie de novo |
| Concluído | tudo certo |
| Não se aplica | não há esse documento no mês (ex.: sem folha de pagamento) |

Se um item não existir no mês, use **Não se aplica** e explique; o escritório confirma. O portal envia lembretes antes e depois do prazo.

### Agenda de pagamentos
As guias publicadas pelo escritório (DAS, DARF, FGTS etc.) aparecem no mês do vencimento, com o valor e a situação: **a vencer**, **vence hoje**, **vencida** ou **paga**. Use as setas para trocar de mês.

- Depois de pagar, toque em **Paguei**: informe a data, o valor pago (com juros, se houver) e anexe o **comprovante** (PDF ou foto). O escritório é avisado na hora e o comprovante já entra na pendência "Comprovantes de pagamento das guias".
- Informou por engano? Use **Desfazer**.
- Guias de meses anteriores sem pagamento informado aparecem no topo, em destaque.
- Quando a guia ainda não foi publicada, aparece a **previsão** (estimativa) dos impostos do mês, se a previsão já estiver liberada.

### Vencimentos
Certificado digital, alvará de funcionamento, licenças (sanitária, bombeiros, ambiental), certidões negativas (CND federal, estadual e municipal, CRF do FGTS, CNDT), procurações e contratos com data de validade. O portal avisa **30, 15 e 5 dias antes e no dia do vencimento** — no sino, por e-mail e, se você autorizou, por WhatsApp. A Visão geral mostra o que vence nos próximos 30 dias.

- **Novo vencimento**: escolha o tipo, informe a validade e quem renova (o escritório ou a empresa). Dá para ligar o arquivo do documento que já está no portal.
- **Renovar**: informe a nova validade; os avisos recomeçam pela nova data.
- **Arquivar**: quando o documento não é mais necessário (para de avisar). Excluir é só com o escritório.

### Notas automáticas
Com o **certificado digital A1 (e-CNPJ)** da empresa, o portal busca sozinho as notas fiscais nos serviços oficiais — as NF-e que a empresa recebe (SEFAZ) e as NFS-e emitidas e tomadas (Ambiente Nacional da NFS-e) — e as coloca em **Meus documentos**, sem ninguém precisar enviar.
- Para ativar (empresário titular): **Notas automáticas → Certificado digital A1**, escolha o arquivo `.pfx` ou `.p12`, digite a senha e marque a autorização. O portal confere se o certificado é da empresa e se está válido. **A senha não é guardada**: o arquivo é aberto só nesse momento, e a chave fica guardada cifrada, usada apenas pelo servidor.
- Sem certificado, a busca fica **desconectada** e nenhuma consulta é feita. O escritório também pode cadastrar o certificado, com a sua autorização por escrito — você é avisado.
- **O que buscar**: marque NF-e, NFS-e e, se quiser, a **ciência da emissão automática** — sem ela, a SEFAZ entrega só o resumo das notas recebidas (fornecedor, valor e data); a ciência apenas informa que a empresa tomou conhecimento da nota (não confirma nem recusa a operação) e libera o XML completo.
- A tela mostra a situação (ativa, pausada, com erro, certificado vencido), as NF-e recebidas (com o link para o XML quando ele chega) e o histórico das buscas. A validade do certificado também aparece em **Vencimentos**, com os avisos de renovação.
- Para desligar, use **Remover certificado**: a busca para e o certificado é apagado do portal. As notas já trazidas continuam em Documentos.
- **XML do mês em lote**: na mesma tela, escolha o mês de emissão e os tipos de nota (NF-e de entrada e de saída, NFC-e, CT-e, NFS-e prestadas e tomadas, eventos de cancelamento e correção) e clique em **Gerar arquivo do mês**. O portal monta um ZIP com os XML separados em pastas por tipo, a planilha **Relacao das notas.xlsx** (número, chave, emitente, destinatário, valor e situação de cada nota) e um **LEIA-ME** com o resumo — inclusive as NF-e que a SEFAZ entregou só em resumo. Entram as notas buscadas com o certificado e as enviadas em Documentos. Você recebe um aviso quando o arquivo fica pronto; ele fica disponível por **7 dias**. Meses com muitas notas saem em partes (parte 1 de 2, 2 de 2...). Cada download fica registrado.

### Meus documentos
Tudo o que a empresa enviou e o que o escritório publicou (guias de impostos, folha, relatórios). Cada documento mostra a situação, o histórico e as versões. Baixar ou visualizar fica registrado.

> A visualização de uma guia no portal não comprova o pagamento.

### Financeiro (quando liberado)
- **Lançamentos**: contas a pagar e a receber, com vencimento, categoria e situação. Ao pagar ou receber, registre a baixa.
- **Contas e saldos**: contas bancárias, caixa e cartões com os saldos.
- **Operações**: transferências entre contas, cartão de crédito, maquininhas, empréstimos e estoque — registros com regras próprias para não distorcer o resultado.
- **Recorrências**: despesas e receitas que se repetem (aluguel, mensalidades).
- **Importar extratos**: extratos do banco (OFX ou planilha); as movimentações seguem para a conciliação.
- **Notas fiscais**: notas lidas dos XML enviados. Lançamentos criados a partir de XML ou de leitura automática chegam como **sugeridos** e precisam ser confirmados.
- **Cadastros**: plano de contas gerencial (categorias), clientes e fornecedores, centros de custo e projetos.

### Relatórios
- **Saúde financeira**: painel com indicadores, gráficos e um resumo em linguagem simples.
- **DRE**: receitas, custos, despesas e resultado (lucro ou prejuízo) por mês, trimestre ou ano. Clique em uma linha para ver os lançamentos.
- **Fluxo de caixa**: entradas e saídas realizadas e a projeção dos próximos meses.
- **Publicados**: o pacote mensal preparado e revisado pelo escritório (pode ser **preliminar** ou **revisado**).
- **Período**: escolha um mês, um trimestre, o ano, os últimos 12 meses ou **De um mês até outro…** (qualquer intervalo de até 36 meses, por exemplo de 04/2026 até 08/2026). O relatório mostra cada mês e o total, comparado com o mesmo número de meses imediatamente anteriores.
- Todos podem ser baixados em **PDF** ou **Excel**, no período escolhido.

Os relatórios são gerenciais e dependem dos documentos e lançamentos disponíveis; quando faltam dados, o portal avisa que o resultado é parcial.

### Cálculos (previsão de impostos e rescisão)
- **Previsão de impostos**: quando todos os documentos obrigatórios do mês forem enviados, aparece a estimativa dos impostos que vencem no mês seguinte, pelo regime da empresa (MEI, Simples Nacional, Lucro Presumido ou Lucro Real): DAS, PIS, Cofins, IRPJ, CSLL, ISS, ICMS e os encargos da folha (INSS, IRRF e FGTS), com o vencimento de cada guia. Toque em **ver cálculo** para ver a conta. Enquanto faltar algum documento, a tela mostra o que falta e um atalho para enviar.
- É sempre uma **estimativa**: os valores oficiais são os das guias publicadas pelo escritório em **Meus documentos**. Quando a guia já foi emitida, o valor dela aparece ao lado.
- **Simulação de rescisão**: escolha um colaborador, vários ou **todos**, o tipo de desligamento (sem justa causa, pedido de demissão, acordo, justa causa, fim do contrato de experiência) e a data. O portal mostra as verbas, o FGTS, a multa e o **custo total para a empresa**. Também dá para simular sem cadastro (**Simulação avulsa**).
- **Colaboradores**: cadastro simples (nome, cargo, admissão, salário). Ele alimenta a folha da previsão e a simulação de rescisão. Quando alguém sair, informe a **data de saída**.

### Economia de impostos (auditor fiscal)
O escritório confere as suas notas fiscais de compra e de venda dos últimos 5 anos procurando imposto pago a mais (por exemplo, PIS/Cofins de produtos monofásicos ou ICMS já pago por substituição tributária, cobrados de novo) e pontos de atenção. Quando o escritório encontra e confirma algo, você recebe um aviso e vê em **Economia de impostos**: o mês, a explicação em linguagem simples, o **valor estimado** e o **prazo para pedir de volta** (5 anos do pagamento).
- Toque em **Quero que o escritório cuide disso** para pedir que o escritório confira a apuração e faça o pedido de restituição. O pedido vira uma **Solicitação**, onde você acompanha tudo.
- O valor é uma estimativa feita com regras fixas da lei, conferida pela equipe; o valor final depende da análise do escritório.

### Solicitações
Peça um serviço ao escritório sem precisar ligar: **Solicitações → Nova solicitação**. Escolha o serviço (alteração contratual, abertura de filial, encerramento, admissão, férias, demissão, declaração de faturamento, DECORE, Imposto de Renda dos sócios, certidões, parcelamento, ajuda com nota fiscal ou outro), escreva um resumo e os detalhes e marque **É urgente** se for o caso. O portal mostra o prazo estimado e o que costuma ser preciso enviar.
- Cada solicitação tem um número, a situação (**Aberta**, **Em andamento**, **Aguardando a empresa**, **Concluída** ou **Cancelada**), o prazo, o responsável no escritório e o histórico de tudo o que aconteceu.
- Anexos e conversa ficam na própria solicitação (é uma conversa das **Mensagens**), com respostas na hora.
- Quando o escritório pedir algo, a situação muda para **Aguardando a empresa** e o pedido aparece no histórico. Envie o que foi pedido na conversa e toque em **Já enviei o que foi pedido** para devolver ao escritório.
- Você é avisado de cada mudança (sino, e-mail e — se autorizou — WhatsApp). Enquanto a solicitação estiver aberta ou aguardando você, dá para **cancelar** informando o motivo.
- Quem tem acesso às **Mensagens** da empresa vê e abre solicitações.

### Mensagens
Converse com o escritório por assunto, com anexos. Com a conversa aberta, as respostas aparecem **na hora**, sem atualizar a página. Fora dela, chegam no sino de avisos, por e-mail (se você deixou ativado) e por WhatsApp (se você autorizou). Para não encher sua caixa, o e-mail e o WhatsApp esperam 2 minutos e não são enviados se você já leu a resposta no portal; vários avisos seguidos chegam numa única mensagem.

### Configurações (da empresa)
- **Dados da empresa**: cadastro, contador responsável e contatos do escritório. Para corrigir algo, mande uma mensagem.
- **Usuários e permissões** (somente o empresário titular): convide colaboradores (ex.: quem cuida do financeiro) e escolha o que cada um pode fazer — ver, enviar, baixar, editar o financeiro, ver relatórios. Você só pode liberar o que você mesmo tem. Para tirar o acesso de alguém, use **Revogar acesso**.

---

## 3. Para a equipe do escritório

O menu **Escritório** mostra a carteira inteira; ao escolher uma empresa no seletor, aparece a área daquela empresa (com as mesmas telas do cliente e as ferramentas da equipe).

### Rotina do mês, passo a passo

1. **Início do mês** — a rotina automática cria o checklist de cada empresa e os lançamentos recorrentes. Nada a fazer.
2. **Acompanhar o recebimento** — **Documentos recebidos** mostra tudo o que chegou. Abra cada documento e use **Aprovar** ou **Pedir correção** (explicando o motivo). **Pendências** mostra o que falta em cada empresa; os lembretes saem sozinhos, e dá para usar **Enviar lembrete** quando precisar.
3. **Financeiro** — os XML enviados pelos clientes viram notas e lançamentos **sugeridos**; confirme-os em **Financeiro → Lançamentos**. Importe os extratos em **Financeiro → Importar extratos**.
4. **Conciliação** — em **Conciliação**, use **Buscar sugestões** e confirme as que estiverem certas; concilie manualmente o resto (tarifas, transferências, pagamentos agrupados). Informe o **saldo do banco** no fim do mês para conferir a diferença.
5. **Fechamento** — em **Fechamento**, clique em **Iniciar fechamento** e siga as etapas: coleta, conferência, conciliação, revisão e publicação. Cada etapa mostra verificações automáticas (ex.: “3 movimentações sem conciliar”). Pendências marcadas como impeditivas não deixam fechar. Ao final, **Fechar o mês**. Reabrir exige justificativa e permissão específica.
6. **Relatórios** — em **Relatórios → Publicados**, crie o pacote do mês, revise os textos e publique. O cliente é avisado. Se publicar antes do fechamento, ele sai como **preliminar**; depois do fechamento, sai uma nova versão **revisada**.
7. **Mensagens** — responda pela central de **Mensagens** do escritório.

Os quadros **Financeiro**, **Conciliação**, **Fechamentos** e **Relatórios** do menu Escritório mostram em que ponto está cada empresa da carteira.

### Obrigações e prazos (camada interna da equipe)

O menu **Obrigações e prazos** é só do escritório: o cliente não vê nada dele. Ele usa os documentos do portal (guias, recibos e comprovantes) e mostra, para cada empresa, o que precisa ser apurado, entregue e pago, com prazo e responsável.

**Antes de começar (uma vez, administrador)**
1. **Atualizações normativas** — o portal já vem com as regras das principais obrigações federais (Simples Nacional, PIS/Cofins, IRPJ/CSLL, DCTFWeb, eSocial, FGTS, EFD-Contribuições, EFD-Reinf, ECD, ECF e a transição para CBS/IBS), cada uma com a fonte oficial. Elas chegam como **propostas**: abra a fonte, confira e clique em **Validar** e depois em **Aplicar**. Sem isso, nenhum prazo é calculado.
2. **Catálogo** — ICMS, ISS e EFD ICMS/IPI dependem da lei de cada estado e município: abra a obrigação e use **Propor regra** para cadastrar o prazo do Tocantins e de cada município atendido, com a lei e o link oficial. Antes de enviar, use **Simular prazos** para conferir as datas.
3. **Feriados** — os nacionais e os do Tocantins (8/9 e 5/10) já estão cadastrados. Cadastre os feriados municipais (ex.: Porto Nacional) com a lei ou decreto.
4. **Empresas** (do menu Obrigações) — em cada empresa, confira o município, marque se é contribuinte do ICMS/ISS, se tem empregados e pró-labore, e o histórico de regimes (Simples Nacional, Lucro Presumido, Lucro Real — trimestral ou anual — e Lucro Arbitrado). Se a empresa mudou de regime, use **Registrar mudança de regime** a partir da competência certa: as competências antigas continuam com o regime da época.

**No dia a dia**
- **Painel**: atrasadas, o que vence em 7 dias, o que depende do cliente, o que está em revisão e a carga de cada pessoa.
- **Tarefas**: cada obrigação vira até três tarefas por competência — **apuração**, **entrega** e **pagamento** — com prazo interno (antes do legal) e prazo legal. Abra a tarefa, mude a situação (iniciar, aguardando cliente, enviar para revisão, dispensar com motivo) e, para concluir entrega ou pagamento, escolha o recibo ou comprovante que está no portal ou envie o arquivo ali mesmo. Sem o documento, o portal não deixa marcar como transmitido ou pago.
- **Revisão**: quando a tarefa tem revisor, quem executa envia para revisão e quem revisa aprova (conclui) ou devolve com o ajuste.
- **Agenda**: o mês em calendário, pelo prazo interno ou pelo legal, com os feriados.
- **Tabela operacional (Empresas)**: todas as empresas em ordem de razão social; dá para ordenar por nome fantasia ou por urgência de prazo.
- Guias publicadas pelo escritório em **Guias de impostos** entram sozinhas na tarefa de pagamento quando só há uma tarefa possível; nas demais, publique a guia pela própria tarefa.

**Quando uma norma muda**
Abra a obrigação no **Catálogo** e use **Propor alteração** (ou **Propor encerramento**) com a fonte e a data da consulta. Depois que o administrador valida e aplica, a regra antiga é encerrada no mês anterior, as tarefas abertas são recalculadas e as competências anteriores ficam como estavam. Tudo fica na auditoria.

### Avisos de arquivos enviados pelos clientes

Sempre que um cliente envia um arquivo (ou uma nova versão), o escritório é avisado:

- **No sino do portal, na hora**: com o portal aberto, o aviso aparece no canto da tela e o número do sino aumenta sem recarregar a página. Tocar no aviso abre o documento.
- **Vários arquivos seguidos viram um aviso só**: se a Padaria manda 8 arquivos, chega “Padaria enviou 8 arquivos”, com o último arquivo e o link para a lista de recebidos. Depois que você abre o aviso, o próximo envio gera um aviso novo.
- **Quem recebe**: cada pessoa escolhe em **Minha conta → Avisos → Avisar quando um cliente enviar arquivos**:
  - **De todas as empresas** (padrão; para a equipe, as empresas que ela acompanha);
  - **Só das empresas em que sou o contador responsável**;
  - **Não avisar**.
- Arquivo registrado pela própria equipe em nome do cliente não gera aviso. Arquivo que chega para um mês já fechado gera o alerta “Documento recebido após o fechamento” (um aviso só por pessoa).
- **Resumo por e-mail (opcional)**: marque “Também mandar um resumo dos arquivos por e-mail”. O e-mail sai 10 minutos depois do primeiro arquivo, já contando os que chegarem nesse intervalo. Só funciona com o servidor de e-mail configurado.

#### Receber os avisos no celular ou no computador

Os avisos podem chegar como notificação do aparelho, **mesmo com o portal fechado**:

- **Computador (Chrome, Edge, Firefox) e Android (Chrome, Samsung Internet)**: entre no portal → **Minha conta → Avisos → Ativar neste aparelho** → toque em **Permitir** quando o navegador perguntar. Use **Enviar aviso de teste** para conferir.
- **iPhone e iPad (iOS 16.4 ou mais recente)**: a Apple só libera notificações para sites instalados na tela inicial. No Safari, abra o portal → toque em **Compartilhar** → **Adicionar à Tela de Início**. Abra o portal pelo novo ícone, entre com seu e-mail e senha e faça o passo acima.
- O sino também mostra um atalho **Ativar** enquanto o aparelho não recebe os avisos.
- Ao **sair do portal** num aparelho, ele para de receber os avisos até você entrar de novo. Em **Minha conta → Avisos** aparece a lista dos aparelhos que recebem seus avisos; dá para remover qualquer um.
- Os avisos mostram o nome da empresa e do arquivo. Se outras pessoas veem a tela do seu celular, ajuste nas configurações do aparelho para **ocultar o conteúdo das notificações na tela bloqueada**.

### Pagamentos informados pelos clientes
Quando o cliente toca em **Paguei** numa guia, a equipe recebe o aviso "Pagamento informado" e o registro entra no histórico da tarefa de pagamento (Obrigações e prazos). A tarefa **não** é concluída sozinha: abra-a, confira e escolha o comprovante enviado pelo cliente para concluir. Na página da guia aparece a data, o valor e o link do comprovante.

### Notas automáticas da carteira
O menu **Notas automáticas** do escritório mostra cada empresa com a situação da busca (ativa, com erro, pausada, certificado vencido, desconectada), a validade do certificado, a última busca e quantos XML chegaram nos últimos 30 dias, com contadores de busca ativa, erros e certificados vencendo. Clique na empresa para cadastrar ou trocar o certificado (declarando a autorização escrita do cliente), ajustar o que buscar ou **Buscar agora**. A SEFAZ permite uma consulta por hora quando não há documentos novos; o portal respeita essa regra (veja o guia de configuração, seção 13).

**XML da carteira em lote**: no topo da mesma tela, escolha o mês e os tipos e clique em **Gerar para a carteira**. O portal gera um ZIP para cada empresa que tem notas desses tipos no mês (pelas datas de emissão) e avisa quando todos ficam prontos; a lista mostra cada empresa com o botão de baixar, por 7 dias. Os lotes pedidos pela equipe podem incluir arquivos do escritório ainda não publicados e por isso **não aparecem para o cliente**. Na tela de cada empresa também dá para gerar o lote só dela.

### Vencimentos da carteira
O menu **Vencimentos** do escritório lista certificados, alvarás, licenças e certidões de todas as empresas pela validade, com filtros (vencidos, próximos 30 ou 60 dias, tipo) e contadores. Os avisos saem sozinhos pela rotina diária (30, 15 e 5 dias antes e no vencimento), para a equipe da empresa e para o cliente. Cadastre em cada empresa → **Vencimentos**; ao renovar, informe a nova validade.

### Solicitações da carteira
O menu **Solicitações** do escritório lista os pedidos de todas as empresas pelo prazo, com filtros (em aberto, minhas, aguardando o cliente, atrasadas, todas) e contadores de **sem responsável**, **atrasadas** e **aguardando o cliente**. A equipe da empresa é avisada de cada solicitação nova e de cada resposta do cliente.

Na solicitação, use **Andamento** para mudar a situação, escolher o responsável e ajustar o prazo (o padrão vem do catálogo de serviços). Para pedir algo à empresa, escolha **Aguardando a empresa** e escreva no comentário o que falta (o comentário é obrigatório nesse caso e ao cancelar). O cliente vê a mudança na hora e recebe o aviso. Arquivos e conversa ficam na conversa da solicitação. Só a equipe conclui; o cliente pode cancelar ou devolver ao escritório depois de enviar o que foi pedido.

### Cálculos das empresas (previsão de impostos)

Para cada empresa, em **Cálculos → Configuração** (só a equipe vê esta aba):

1. Confira o **regime** (vem de **Obrigações e prazos → Empresas**, com o histórico) e preencha os parâmetros: atividade do MEI; anexo das vendas e dos serviços e Fator R (Simples); percentuais de presunção (Presumido e estimativa do Real, já com os padrões 8%/12% e 32%) e o acréscimo da LC 224/2025 (desmarque se a empresa tiver decisão judicial); alíquota do ISS; cálculo do ICMS e do IPI pelas notas; pró-labore, RAT, FAP e terceiros. Clique em **Salvar configuração**.
2. Em **Receita e folha mês a mês**, informe a receita dos meses anteriores ao uso do portal (o Simples precisa dos últimos 12 meses) ou de meses em que as notas enviadas não representam todo o faturamento. A receita informada substitui a das notas naquele mês.
3. Em **Valores lançados**, inclua o que o cálculo automático não cobre (ICMS-ST, DIFAL, parcelamentos, IRPJ por balancete). Valor negativo reduz a previsão.

A previsão usa os **XML das notas** enviados (vendas pelo CFOP, devoluções, vendas com ICMS-ST, serviços com ISS retido) e o cadastro de colaboradores. Compras e devoluções valem tanto nas notas de entrada emitidas pela empresa quanto nas notas emitidas pelo fornecedor (CFOP de venda dele, como 5.102) e pelo cliente que devolveu (CFOP de devolução de compra, como 5.202); transferências entre estabelecimentos e bonificações não entram. O vencimento de cada guia vem das tarefas de **Obrigações e prazos**, e o valor da guia aparece quando a tarefa de pagamento tem a guia publicada. A equipe vê a previsão sempre; o cliente, só depois de enviar todos os documentos obrigatórios do mês. As tabelas oficiais (Simples, INSS, IRRF, salário mínimo) ficam no código do portal com fonte e vigência; quando mudarem (todo janeiro), precisam ser atualizadas.

#### Comparativo de regimes (planejamento tributário)
Em **Cálculos → Comparativo de regimes** (só a equipe vê), o portal mostra quanto a empresa teria pago no **Simples Nacional**, no **Lucro Presumido** e no **Lucro Real** nos 12 meses escolhidos, com os mesmos dados da previsão (notas, receita informada, colaboradores e pró-labore):

1. Escolha o **período** (12 meses até a competência).
2. Preencha as **premissas** que as notas não informam: a **margem de lucro** para o Lucro Real (lucro antes do IRPJ e da CSLL, em % da receita — se a empresa usa o Financeiro, o portal sugere a margem do resultado do período), a **alíquota média do ICMS** nas vendas fora do Simples (quando as notas já destacam ICMS, a média delas é usada) e a **alíquota do ISS** (vem da configuração). Os créditos de PIS/Cofins do Lucro Real são calculados sobre as compras das notas de entrada.
3. Clique em **Recalcular**. Aparecem o total de cada regime, a carga em % da receita, o regime de **menor custo estimado**, a **economia** em relação ao regime atual, a tabela por tributo, o mês a mês, as premissas usadas, os avisos e as fontes.

Regras do cálculo: o DAS de cada mês usa a receita dos 12 meses anteriores a ele (por isso o portal busca 24 meses; meses sem receita viram aviso); o Presumido calcula o IRPJ e a CSLL por trimestre, com o adicional e o acréscimo da LC 224/2025; o Real usa a margem informada com o adicional anual; ICMS (débito menos os créditos das notas de entrada) e ISS entram só fora do Simples; a contribuição patronal (com 13º e 1/3 de férias) entra fora do Simples e no Anexo IV. Um regime sem alguma premissa aparece como **incompleto** e só fica fora da escolha se ainda puder sair mais barato. FGTS e descontos dos empregados são iguais em todos os regimes e não entram. O regime vale para o ano todo e só muda no começo do ano, e a reforma tributária troca o PIS/Cofins pela CBS a partir de 2027 — o comparativo é um apoio para a análise do escritório, não uma decisão automática.

### Auditor fiscal (imposto pago a mais e riscos)
O menu **Auditor fiscal** do escritório mostra, para a carteira toda, a **possível economia** encontrada, os achados **para revisar**, os **riscos** e a última análise de cada empresa. Em cada empresa → **Auditor fiscal**:

1. A análise roda sozinha alguns minutos depois que chegam notas (enviadas pelo cliente ou trazidas pelas notas automáticas) e de novo todo dia 2 (a faixa do Simples muda a cada mês). Para rodar na hora, clique em **Analisar agora**.
2. O auditor olha os **últimos 5 anos** (prazo para pedir de volta) e aponta, mês a mês:
   - **PIS/Cofins monofásico no DAS** (Simples): vendas de medicamentos, perfumaria, autopeças, pneus, bebidas frias, combustíveis etc. — pela lista oficial de NCM ou porque o mesmo produto foi comprado com CST 04. Mostra quanto o DAS cobrou a mais **se** a receita não foi separada no PGDAS-D (receita × alíquota efetiva do mês × parcela de PIS e Cofins da faixa).
   - **ICMS-ST no DAS** (Simples): produto comprado com ICMS já retido e vendido como tributado (CSOSN 102/CFOP 5.102); mostra a parcela do ICMS cobrada de novo.
   - **PIS/Cofins na revenda de monofásicos** (Lucro Presumido e Real): valor destacado nas notas onde o certo é alíquota zero (CST 04).
   - **ICMS próprio em produto com ST** (regime normal).
   - Riscos: **venda como ST sem compra com ST**, **notas de venda sem IBS/CBS** (obrigatório desde 03/08/2026 no regime normal e a partir de 01/01/2027 no Simples), **alíquota de teste do IBS/CBS** diferente (0,9% e 0,1% em 2026) e **NCM inválido**.
3. Cada achado traz a **confiança** (alta, média ou conferir), o **valor estimado**, a **memória de cálculo**, as notas de exemplo (com link) e a **base legal**. Revise: **Confirmar**, **Descartar** (com o motivo — ele não volta nas próximas análises) ou **Publicar ao cliente** com uma mensagem em linguagem simples (o portal sugere um texto). Depois de resolvido (PGDAS-D retificado, restituição pedida, cadastro corrigido), use **Concluir**. Publicou por engano? **Retirar do cliente** (enquanto ele não tiver pedido ajuda).
4. Quando o cliente toca em **Quero que o escritório cuide disso**, abre uma solicitação do serviço **Recuperação de impostos pagos a mais** para a equipe da empresa.

Para a conta do Simples ficar exata, preencha em **Cálculos → Configuração** o anexo das vendas e, em **Receita e folha mês a mês**, a receita dos meses anteriores ao portal (sem isso o achado aparece com confiança média). O auditor não vê o PGDAS-D: ele mostra quanto foi cobrado a mais caso a separação não tenha sido feita — confira a apuração antes de publicar. A lista de produtos monofásicos usada (com a lei de cada linha) fica no fim da página do auditor da carteira.

### Cadastrar uma empresa nova (administrador)
1. **Empresas → Nova empresa**: digite o **CNPJ** e clique na **lupa** ao lado. O portal busca os dados abertos da Receita Federal e preenche razão social, nome fantasia, CNAE e atividade principal, endereço, telefone e e-mail; sugere o **regime** (MEI ou Simples pela opção registrada na Receita; Presumido ou Real pela última tributação declarada) e mostra a situação cadastral (aviso em vermelho se não estiver ATIVA), abertura, natureza jurídica, porte, atividades secundárias e o quadro de sócios. Marque se quer **cadastrar os sócios como contatos**. Confira, complete o que faltar (inscrições, contador responsável, serviços contratados) e salve. O município do IBGE (usado nos prazos municipais) é preenchido sozinho. Na edição da empresa, a lupa atualiza os dados (o regime só é preenchido se estiver em branco). O plano de contas gerencial e o checklist padrão são criados sozinhos. A base da Receita é atualizada uma vez por mês: empresas abertas há poucas semanas podem ainda não aparecer — aí é só preencher à mão.
2. Na empresa: **Contas bancárias** (contas, saldos iniciais, cartões) e **Checklist mensal** (ajuste os documentos e prazos).
3. **Usuários e permissões → Convidar usuário**: convide o empresário como **Cliente empresário (titular)**. Sem e-mail configurado, o portal mostra o link para copiar e enviar pelo WhatsApp. Se o cliente autorizar, informe o **WhatsApp** dele no convite para que receba os avisos de documentos, mensagens e solicitações (depois, pelo menu da pessoa → **WhatsApp para avisos**).
4. **Responsáveis e contatos**: cadastre quem recebe os lembretes.

### Equipe e permissões (administrador)
- **Convidar pessoa da equipe**: escolha **Equipe contábil** ou **Administrador do escritório**.
- Abra a pessoa para: vincular às empresas que ela atende (com as permissões), mudar o perfil e o cargo, **Gerar novo link de acesso**, **Encerrar sessões**, **Redefinir duas etapas** (perdeu o celular), **Desativar acesso** (saiu do escritório) e **Anonimizar dados (LGPD)**.
- A aba **Usuários dos clientes** lista todos os usuários das empresas, com último acesso e situação.

### Configurações (administrador)
Dados e logomarca do escritório, verificação em duas etapas obrigatória, limites de envio, lembretes (dias, e-mail e WhatsApp), situação das integrações e LGPD (pedidos dos titulares e prazos de guarda). Detalhes em `CONFIGURACAO.md`.

### Auditoria (administrador)
Quem fez o quê e quando: entradas, alterações de cadastro e de permissões, lançamentos, fechamentos, downloads de documentos e de relatórios. Filtre por período, pessoa, empresa e tipo de evento, abra o detalhe para ver o que mudou e exporte em CSV.

---

## 4. Perguntas frequentes

**Ativei os avisos, mas não chegam no celular.** Em **Minha conta → Avisos**, toque em **Enviar aviso de teste**. Se não chegar: confira se as notificações do navegador (ou do app instalado, no iPhone) estão permitidas nas configurações do celular, se o modo “Não perturbe” está desligado e se você não saiu do portal nesse aparelho (ao sair, os avisos param até entrar de novo). No computador, o navegador precisa estar aberto (pode estar minimizado).

**O cliente pode ver dados de outra empresa?**
Não. Cada pessoa só vê as empresas às quais foi vinculada, e o banco de dados bloqueia qualquer tentativa de acesso indevido.

**O portal envia algo para a Receita, SEFAZ ou prefeitura?**
Só na busca automática de notas, quando a empresa cadastra o certificado digital e autoriza: o portal consulta a SEFAZ e o Ambiente Nacional da NFS-e para trazer as notas da própria empresa e, se ela ativar, registra a ciência da emissão das NF-e recebidas. Fora isso, nada é enviado: declarações, guias e demais obrigações continuam sendo feitas pelo escritório nos sistemas próprios. A presença de protocolo em um XML não comprova a regularidade da nota.

**A leitura automática de documentos é confiável?**
Ela sugere dados (CNPJ, datas, valores) e sempre passa por conferência de uma pessoa antes de virar lançamento.

**O que acontece quando alguém sai do escritório?**
Em **Equipe e permissões**, abra a pessoa e use **Desativar acesso**: o login é bloqueado na hora e as sessões abertas são encerradas. O histórico continua na auditoria.

**O portal calcula os prazos sozinho?**
Só a partir de regras validadas, com fonte oficial. Sem regra validada, a obrigação aparece como “sem regra” ou “aguardando validação” e nenhuma data é inventada. Os prazos consideram fins de semana e feriados (nacionais para as obrigações federais; estaduais e municipais quando a regra pede).

**O portal transmite declarações ou paga guias?**
Não. As declarações e os pagamentos continuam nos sistemas oficiais; o portal registra o andamento, guarda o recibo ou comprovante e só marca a tarefa como concluída com esse documento.

**A previsão de impostos é o valor que vou pagar?**
É uma estimativa feita com os documentos enviados e as tabelas oficiais. O valor oficial é o da guia emitida pelo escritório: retenções, monofásicos, substituição tributária, créditos e outros ajustes podem mudar o resultado.

**Os lembretes e avisos por WhatsApp funcionam?**
Somente depois de configurada a integração oficial do WhatsApp Business (veja `CONFIGURACAO.md`). Enquanto isso, a integração aparece como desconectada e nada é enviado por WhatsApp. Depois de ativada, os avisos só vão para clientes que autorizaram, e cada um pode desligar em **Minha conta → Avisos**.
