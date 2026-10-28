# Privacidade e serviços externos

Registro, em linguagem simples, de **quais serviços de fora participam do funcionamento do portal, quais dados cada um recebe e como estão configurados** — base para a política de privacidade e para o atendimento à LGPD (Lei nº 13.709/2018).

Controladora dos dados: **GUARESE'S ON SOLUCOES EMPRESARIAIS LTDA** (CNPJ 62.935.399/0001-50), Praça do Centenário, nº 713, Centro, Porto Nacional – TO, CEP 77.500-000 — contato: onguaresescontato@gmail.com.

## 1. Resumo

- Os dados ficam no **Supabase**, na região de **São Paulo**, com criptografia em trânsito e em repouso.
- O site roda na **Vercel**, também na região de **São Paulo**.
- E-mail e WhatsApp só funcionam quando o escritório os configura; enquanto isso ficam **desconectados** e nada é enviado.
- A busca automática de notas (SEFAZ e Ambiente Nacional da NFS-e) só acontece nas empresas que cadastraram o certificado digital A1, com autorização registrada; a senha do certificado não é guardada e a chave fica cifrada no servidor (seção 12).
- **Nenhum dado ou documento de cliente é enviado a serviços de inteligência artificial**, nem usado para treinar modelos. A leitura de imagens (OCR) acontece dentro do próprio servidor do portal.
- O navegador dos usuários só se comunica com o endereço do portal e com o Supabase (a política de segurança de conteúdo do site bloqueia qualquer outro destino). As fontes e ícones são servidos pelo próprio portal.

## 2. Serviços externos

| Serviço | Papel (LGPD) | Para que é usado | Dados que recebe | Onde | Configurações de privacidade |
| --- | --- | --- | --- | --- | --- |
| **Supabase** (Supabase Inc.) | operador | banco de dados, login (senhas e verificação em duas etapas) e armazenamento dos arquivos | todos os dados do portal: cadastros, documentos, lançamentos, mensagens, registros de acesso | região `sa-east-1` (São Paulo) | regras de acesso por linha (RLS) em todas as tabelas; arquivos em armazenamento **privado** entregues por links temporários de 2 minutos; cadastro público desligado; senhas guardadas apenas pelo serviço de autenticação; chave secreta só no servidor |
| **Vercel** (Vercel Inc.) | operador | hospedagem do site e execução do servidor (páginas, relatórios, leitura de arquivos) | as requisições dos usuários (inclui IP e navegador); arquivos ficam **só na memória**, durante a leitura automática ou a geração de relatórios | funções na região `gru1` (São Paulo); conteúdo estático (páginas sem dados) em rede de distribuição | respostas com dados não são guardadas em cache (`no-store`); variáveis secretas marcadas como protegidas; registros técnicos por tempo limitado conforme o plano |
| **Provedor de e-mail (SMTP)** — escolhido pelo escritório; no portal oficial, o **Gmail** (Google), pela conta de contato do escritório | operador | convites, avisos e lembretes por e-mail | e-mail do destinatário, assunto e texto do aviso (com link para o portal). **Documentos não são anexados** | conforme o provedor | desconectado até o escritório informar as credenciais; cada pessoa pode desligar os avisos por e-mail em **Minha conta** |
| **WhatsApp Business Platform** (Meta) | operador | lembretes de documentos pendentes e avisos ao cliente (documento ou relatório publicado, mensagem e solicitação do escritório) | número de WhatsApp do contato ou do usuário cliente e o texto do modelo aprovado: nome da empresa, mês, quantidade de pendências ou o título curto do aviso (ex.: nome do documento ou assunto da mensagem) e link do portal. **Documentos e o conteúdo das mensagens não são enviados** | conforme a Meta | desconectado até haver token, número e modelo aprovado; lembretes só para os contatos marcados com “recebe lembretes”; avisos só para clientes que autorizaram (registro na auditoria), com desativação a qualquer momento em **Minha conta → Avisos**; avisos seguidos reunidos numa única mensagem e dispensados se já vistos no portal |
| **Serviços de notificação dos navegadores** — Google (Firebase Cloud Messaging), Apple (Apple Push Notification service), Mozilla (Push Service) e Microsoft (Windows Push Notification Services), conforme o navegador de cada pessoa | operador | entregar os avisos do portal no celular ou no computador de quem ativou | o **conteúdo cifrado de ponta a ponta** (o serviço não consegue ler): título e texto curto do aviso (ex.: nome da empresa, nome do arquivo, mês e quem enviou) e o caminho da página do portal. O serviço vê apenas o endereço de entrega do aparelho, o horário e o tamanho da mensagem | conforme o serviço do navegador | só funciona para quem ativou, aparelho por aparelho; nenhum documento é enviado; o aviso só vai para aparelhos com a sessão ativa; endereços cancelados são apagados; desativação a qualquer momento em **Minha conta → Avisos** |
| **BrasilAPI** (projeto comunitário de código aberto) e, se ela estiver fora do ar, **Minha Receita** (mesma base) | — | buscar os dados públicos do CNPJ no cadastro de empresas (dados abertos da Receita Federal) | **apenas o número do CNPJ** digitado pela equipe, enviado pelo servidor do portal (o navegador não fala com esses serviços); nenhum dado de usuário ou de cliente | serviços na internet | só quando a equipe clica na lupa do CNPJ; os dados que voltam são públicos (cadastro aberto da Receita, inclusive o quadro de sócios) e são conferidos antes de salvar; o retrato da consulta fica guardado com a empresa |
| **jsDelivr** (rede de distribuição) | — | download do modelo público do idioma português usado pelo OCR | **nenhum dado de cliente** (apenas o servidor baixa um arquivo público) | global | pode ser evitado informando `OCR_CAMINHO_IDIOMAS` |
| **GitHub** | — | guarda o código-fonte do portal | **nenhum dado de cliente** | — | repositório do escritório; segredos nunca vão para o repositório |
| **ClamAV** (opcional, servidor do escritório) | — | varredura antivírus dos arquivos enviados | o arquivo, para verificação, sem armazenamento | servidor indicado pelo escritório | desconectado até ser configurado |
| **SEFAZ — Ambiente Nacional da NF-e** e **Ambiente de Dados Nacional da NFS-e** (Receita Federal / SERPRO) | — (órgãos públicos; os documentos são da própria empresa) | **notas automáticas**: buscar as notas fiscais da empresa e, se ela ativar, registrar a ciência da emissão das NF-e recebidas; quando uma pessoa pede, nota a nota, registrar a confirmação da operação | o CNPJ e a UF da empresa e o número da última nota recebida (NSU); o **certificado digital da empresa é apresentado na conexão** (autenticação TLS — a chave privada nunca é enviada); na ciência, o evento assinado com a chave da nota, o CNPJ e a data e hora | Brasil (serviços nacionais) | desligado em cada empresa até o certificado ser cadastrado, com a autorização do cliente registrada; consultas limitadas às regras da SEFAZ; nenhum outro dado é enviado; na demonstração as consultas ficam desligadas |
| **SEFAZ autorizadora da NF-e** (SEFAZ do estado do emitente ou SEFAZ Virtual — SVRS/SVAN) | — (órgãos públicos; a nota é da própria empresa) | **emissão de NF-e** pelo portal: autorizar, consultar, cancelar e registrar carta de correção das notas que a empresa pede | a nota assinada com o certificado da empresa (emitente, comprador, produtos, valores, impostos, transporte e pagamento); nos eventos, a chave da nota e o texto | Brasil | desligada em cada empresa até o escritório configurar e registrar a autorização do cliente; só envia quando alguém emite; na demonstração fica desligada (seção 18) |
| **Outros órgãos públicos** | — | obrigações legais dos serviços contábeis | conforme a legislação | — | fora as notas automáticas e a emissão de notas (NFS-e e NF-e), o portal não consulta nem envia nada a órgãos públicos |

## 3. Inteligência artificial

- O portal **não usa** serviços de inteligência artificial externos.
- Sugestões de conciliação, classificação de lançamentos, leitura de XML, os resumos em texto dos relatórios e o **auditor fiscal** são calculados por **regras fixas** dentro do próprio portal.
- O OCR (Tesseract) roda **no servidor do portal**; nenhuma imagem ou PDF sai dele para ser lido.
- O assistente de programação usado para construir o portal não faz parte do sistema publicado: nenhum dado do portal é enviado a ele. As chaves temporárias usadas na publicação devem ser apagadas logo após o uso (veja `IMPLANTACAO.md`).

Se um dia algum recurso de IA externa for adotado, ele deverá ser documentado aqui (serviço, dados enviados, região e a configuração que impede o uso dos dados para treinamento) antes de ser ativado, e a política de privacidade deverá ser atualizada.

## 4. Dados tratados pelo portal

| Categoria | Exemplos | Base legal principal |
| --- | --- | --- |
| Identificação e acesso | nome, e-mail, telefone, cargo, registros de entrada (data, hora, IP, navegador) | execução de contrato; legítimo interesse (segurança) |
| Documentos das empresas | notas fiscais, extratos, comprovantes, folha, contratos — podem conter dados de sócios, empregados, clientes e fornecedores | execução de contrato; cumprimento de obrigação legal |
| Dados financeiros e contábeis | lançamentos, contas, conciliações, relatórios | execução de contrato; obrigação legal |
| Comunicação | mensagens e anexos trocados com o escritório | execução de contrato |
| Colaboradores das empresas (área Cálculos) | nome, cargo, data de admissão e saída, salário, adicionais fixos, número de dependentes para o IR, férias vencidas e saldo do FGTS informado — **sem CPF nem documentos pessoais** | execução de contrato (o cliente é o controlador dos dados dos seus empregados; o escritório atua como operador); cumprimento de obrigação legal |
| Hóspedes dos hotéis (gestão do hotel) | nome, CPF ou outro documento, nascimento, gênero, nacionalidade, profissão, telefone, e-mail, endereço e os dados da viagem (motivo, transporte, placa, procedência e destino), estadias, consumo e pagamentos | cumprimento de obrigação legal (Ficha Nacional de Registro de Hóspedes, Lei nº 11.771/2008) e execução de contrato (o hotel é o controlador; o escritório atua como operador) |
| Auditoria | quem fez o quê e quando | obrigação legal; legítimo interesse |

## 5. Medidas de segurança

- **Isolamento por empresa** no banco (Row Level Security) e verificação de permissão no servidor e na interface; testes automáticos garantem que um cliente não acessa dados de outro.
- **Permissões por empresa e por operação** (ver, enviar, baixar, aprovar, editar o financeiro, publicar relatórios…). Os dados de colaboradores e a previsão de impostos só aparecem para quem tem a permissão de cálculos da empresa (por padrão, o empresário titular e o escritório).
- **Senhas** fortes guardadas somente pelo Supabase Auth; **verificação em duas etapas** disponível para todos e que pode ser exigida pelo escritório. Com a opção “não pedir o código de novo hoje”, a sessão já confirmada com o código fica guardada no aparelho até o fim do dia: ao fechar o portal ela é **travada no banco** (nenhum dado é entregue a ela) e só volta com a senha, conferida pelo servidor; 5 senhas erradas encerram a sessão.
- **Sessões** revogáveis: cada pessoa vê e encerra os próprios dispositivos; o administrador encerra sessões e desativa acessos na hora.
- **Arquivos**: armazenamento privado, links temporários, conferência do tipo pelo conteúdo real, verificação de integridade (SHA-256), limites contra “bombas” de ZIP e antivírus opcional.
- **Auditoria** que nenhum usuário consegue alterar, com entradas, alterações, permissões e downloads.
- **Cabeçalhos de segurança** no site (política de conteúdo com nonce, proteção contra enquadramento, HTTPS obrigatório).
- **Chaves secretas** apenas no servidor; nada sensível no código ou no navegador.

## 6. Guarda e eliminação

- Os documentos seguem os prazos legais (em regra, ao menos 5 anos para documentos fiscais e contábeis e prazos maiores para trabalhistas e previdenciários). O escritório define os prazos em **Configurações → Privacidade**.
- Nada é apagado automaticamente: o portal lista os documentos com prazo vencido e o administrador decide a eliminação, que fica registrada na auditoria.

## 7. Direitos dos titulares

1. A pessoa faz o pedido em **Minha conta → Privacidade** (ou pelo e-mail do escritório). Ali também baixa uma cópia dos próprios dados (arquivo JSON).
2. O administrador recebe o pedido em **Configurações → Privacidade (LGPD)** e responde pelo portal — a LGPD prevê resposta em até 15 dias.
3. Para exclusão de dados pessoais, o administrador usa **Anonimizar dados (LGPD)** na página da pessoa em **Equipe e permissões**: nome, e-mail e telefone são removidos e o acesso é bloqueado. Documentos fiscais e contábeis permanecem pelo prazo legal.

## 8. Demonstração e dados reais

- A demonstração usa **somente dados fictícios** (empresas marcadas “DEMO”, e-mails do domínio reservado `.test`) e mostra uma faixa de aviso no topo de todas as telas.
- Demonstração e produção ficam em **projetos separados** no Supabase e na Vercel; o script de dados fictícios se recusa a rodar em produção.

## 9. Incidentes de segurança

Em caso de suspeita de vazamento ou acesso indevido:

1. Desativar imediatamente os acessos envolvidos (**Equipe e permissões**) e encerrar as sessões.
2. Trocar as chaves do Supabase (**Project Settings → API Keys**) e atualizar a variável `SUPABASE_SECRET_KEY` na Vercel.
3. Consultar a **Auditoria** para entender o que foi acessado.
4. Avaliar a comunicação à ANPD e aos titulares afetados no prazo definido pela autoridade (atualmente, 3 dias úteis).

## 10. Obrigações e prazos

A camada operacional (tarefas, regras, feriados e normas) roda inteiramente no banco do portal. A tabela de municípios (IBGE) e os feriados foram carregados na instalação, com a fonte de cada um; nenhum dado de cliente é enviado a serviços externos para calcular prazos. As fontes oficiais citadas nas regras são apenas links para consulta da equipe.

## 11. Avisos no celular e no computador

- As notificações no aparelho seguem o padrão Web Push: o conteúdo é cifrado no servidor do portal com chaves do próprio aparelho (RFC 8291), e o serviço do navegador só repassa a mensagem. Não há anúncios, perfil de uso nem uso dos dados para treinar inteligência artificial.
- O texto mostrado tem o mínimo necessário para identificar o aviso; o conteúdo dos documentos nunca é enviado. Os avisos aparecem na tela do aparelho: quem divide o celular ou deixa a tela visível pode ocultar o conteúdo das notificações na tela bloqueada nas configurações do aparelho.
- A ativação e a desativação ficam registradas na auditoria. Ao sair do portal num aparelho, ele deixa de receber os avisos até a pessoa entrar de novo.

## 12. Certificado digital e notas automáticas

- **Autorização**: o certificado A1 só é cadastrado pelo empresário titular (que autoriza no próprio portal) ou pela equipe, que declara ter a autorização escrita do cliente; o cliente é avisado e pode remover a qualquer momento. O texto da autorização, quem cadastrou e quando ficam registrados (auditoria).
- **A senha do certificado não é guardada.** O arquivo é aberto uma vez, no cadastro; o portal guarda apenas a chave privada e o certificado, **cifrados (AES-256-GCM)** com uma chave que existe só na hospedagem (`CERTIFICADOS_CHAVE`). A tabela com o conteúdo cifrado não é acessível pela API do banco: só o processador da fila a lê, e decifra o conteúdo apenas na memória, durante a consulta. Ninguém consegue baixar o certificado pelo portal.
- **Remoção**: ao remover ou trocar o certificado, o conteúdo cifrado é apagado do banco e a busca é desligada.
- **O que chega**: as notas e eventos fiscais da própria empresa, que passam a ficar em Documentos como os XML enviados pelo cliente. Os resumos de NF-e (fornecedor, valor, data, situação) ficam visíveis para quem acessa os documentos da empresa.
- **Ciência da emissão**: só com a opção ativada pela empresa. Ela apenas informa à SEFAZ que a empresa tomou conhecimento da nota (não confirma nem recusa a operação) e libera o XML completo.
- **Sem inteligência artificial**: os XML são lidos por regras dentro do portal, como os enviados pelo cliente.
- **XML em lote**: o ZIP do mês é montado no próprio portal, a partir dos arquivos já guardados, e fica no armazenamento privado por **7 dias** (depois é apagado pela rotina diária). Só quem tem a permissão de baixar os documentos da empresa pede e baixa; o arquivo não tem link direto — cada download passa pela conferência de permissão, gera um link de 1 minuto e registra o acesso a cada documento do lote. Lotes pedidos pela equipe ficam só com a equipe. Se algum documento for excluído depois, o lote deixa de ser entregue.
- **Bibliotecas**: o arquivo `.pfx` é aberto pela biblioteca node-forge (só no cadastro, no servidor). O alerta de segurança conhecido dessa biblioteca (GHSA-86w9-cpqp-85rv) trata da verificação de assinaturas RSA, função que o portal não usa; a conexão segura e a assinatura da ciência usam as funções nativas do Node.

## 13. Auditor fiscal

- **Onde roda**: dentro do portal (processador da fila), sobre as notas que já estão em Documentos. **Nada é enviado** a órgãos públicos, a serviços externos ou a inteligência artificial; o auditor não consulta nem altera o PGDAS-D.
- **O que guarda**: os achados (mês, regra, valor estimado, memória de cálculo, até 15 notas de exemplo com descrição e valor do item — ou, nas notas de serviço, o nome do tomador —, base legal), quem revisou, descartou ou publicou, e o motivo. Para o Fator R dos serviços no Simples, usa só os valores da folha cadastrada (sem nomes).
- **Quem vê**: a equipe com a permissão "Conduzir o auditor" vê tudo; o cliente (permissão "Economia de impostos") vê só o que a equipe publicou da própria empresa — a mensagem, o mês, o valor estimado e o prazo —, nunca a memória interna. As ações de revisão ficam no registro de atividades.
- **Catálogo de produtos monofásicos**: lista pública por NCM, montada a partir do texto vigente das leis (Leis 10.147/2000, 10.485/2002, 13.097/2015, 9.718/1998 e outras), visível para a equipe e alterável só pelo administrador.

## 14. Maquininhas

- **Onde roda**: dentro do portal (processador da fila), sobre os relatórios de vendas (CSV, Excel ou a Lista de Vendas da Cielo em PDF, cujo texto é extraído dentro do próprio portal) enviados em Documentos. **Nada é enviado** às adquirentes, a serviços externos ou a inteligência artificial, e nenhuma adquirente é consultada: a conexão direta (EDI ou API) fica **desconectada** até ser ativada com a autorização de cada empresa.
- **O que guarda**: de cada venda, a data, a bandeira, a modalidade, as parcelas, os valores (bruto, taxa e líquido), o NSU, o código de autorização, o terminal e a previsão de pagamento — não guarda número de cartão nem dados de quem comprou (as outras colunas ficam só no arquivo original, em Documentos). As primeiras 5 linhas do relatório, como vieram no arquivo, ficam guardadas para a conferência das colunas. Guarda também os contratos e taxas cadastrados e os formatos aprendidos (só os nomes e as posições das colunas, sem dados de vendas).
- **Quem vê**: a equipe vinculada à empresa e, no cliente, quem tem a permissão "Conferência das taxas" (o empresário, por padrão). Cadastrar contratos, conferir colunas e excluir relatórios exige "Contratos e relatórios". O formato aprendido pela equipe vale para todo o escritório; o aprendido pelo cliente, só para a empresa dele.
- **Registro**: contratos, taxas, conferência das colunas, importações, exclusões e cada download da planilha ficam no registro de atividades.

## 15. SPED Fiscal × XML

- **Onde roda**: dentro do portal (processador da fila), sobre o arquivo da EFD enviado em Documentos e os XML que o portal já tem. **Nada é enviado** à Receita, à SEFAZ, a serviços externos ou a inteligência artificial; o portal não transmite nem altera a EFD.
- **O que guarda**: do arquivo, o cabeçalho (período, CNPJ, UF, IE, perfil), as notas escrituradas (modelo, situação, série, número, chave, datas, valor total, ICMS, ICMS-ST, IPI, CFOP e o nome e o CNPJ/CPF do cliente ou fornecedor), o resumo por CFOP e a apuração do ICMS; e os pontos encontrados na conferência. O arquivo original fica em Documentos, com as mesmas regras de guarda.
- **Quem vê**: só a equipe com a permissão "Conduzir o auditor" (uso interno, antes da transmissão). O cliente vê o arquivo em **Meus documentos**, como qualquer documento da empresa.
- **Registro**: cada conferência e cada exclusão ficam no registro de atividades.

## 16. Apuração do ICMS

- **Onde roda**: dentro do portal, sobre os XML de notas que o portal já tem e as escolhas da equipe. **Nada é enviado** à SEFAZ, a serviços externos ou a inteligência artificial; o portal não emite DARE/GNRE nem transmite a EFD.
- **O que guarda**: a destinação das compras escolhida pela equipe (por item, nota ou CNPJ do fornecedor), os lançamentos da apuração (descrição, valor, observação), o saldo credor informado e o resultado de cada conferência (totais e guias, sem os dados das notas).
- **Quem vê**: a apuração completa (com fornecedores e itens) é da equipe com a permissão de gerenciar os cálculos. O cliente vê só as guias de ICMS na **Previsão de impostos** da própria empresa.
- **Registro**: destinações, lançamentos, conferências e reaberturas (com motivo) ficam no registro de atividades.

## 17. Emissão de NFS-e

- **Serviço externo**: o **Emissor Nacional da NFS-e** (Sefin Nacional, Receita Federal / Comitê Gestor da NFS-e), serviço público oficial. Só recebe dados quando a empresa pede uma nota (ou o cancelamento) e a emissão está ligada.
- **O que é transmitido**: a declaração da nota (DPS) assinada com o certificado da empresa — CNPJ e inscrição municipal da empresa, dados do tomador informados no pedido (CNPJ/CPF, nome, endereço, e-mail e telefone, se preenchidos), serviço, valor, data e local da prestação, tributos aproximados e informações complementares. No cancelamento, a chave da nota e o motivo.
- **O que fica no portal**: o pedido, o XML da nota autorizada e, em produção, o registro nos documentos fiscais da empresa. Com o e-mail do tomador preenchido e o envio ligado, o PDF e o XML vão para ele pelo e-mail do escritório.
- **Quem vê**: quem tem a permissão de emitir notas da empresa (o empresário, por padrão) e a equipe. Configurar a emissão é só da equipe; ligar exige a autorização do cliente registrada.
- **Sem inteligência artificial**: a nota é montada por regras fixas do leiaute oficial; nenhum dado vai para serviço de IA.
- **Demonstração**: não tem certificado; a emissão fica desligada e nada é enviado.

## 18. Emissão de NF-e (nota de produto)

- **Serviço externo**: a **SEFAZ autorizadora** do estado do emitente (ex.: SEFAZ-MT) ou a SEFAZ Virtual que atende o estado (SVRS, SVAN), serviço público oficial. Só recebe dados quando alguém emite uma nota (ou pede o cancelamento ou a carta de correção) e a emissão está ligada. O **Testar conexão com a SEFAZ** envia só o pedido de status do serviço, sem dados de clientes.
- **O que é transmitido**: a nota assinada com o certificado da empresa — dados do emitente (CNPJ ou CPF do produtor, inscrição estadual e endereço), do comprador (CNPJ/CPF, inscrição estadual, endereço, e-mail e telefone do cadastro), produtos, valores, impostos, transporte (transportador, placa) e pagamento; o CNPJ do escritório como autorizado a baixar o XML (se ligado) e o responsável técnico. Nos eventos, a chave da nota, o motivo do cancelamento ou o texto da correção.
- **Guias**: o portal só **calcula** os valores. A guia oficial (DAR, DARE, GNRE) é gerada pela equipe no site do órgão; o portal não envia dados ao Portal GNRE (integração desconectada até o credenciamento).
- **O que fica no portal**: o pedido, os dados calculados, o XML assinado e o autorizado, os eventos e as guias anexadas; em produção, o registro nos documentos fiscais da empresa. Com o e-mail do comprador cadastrado e o envio ligado, o DANFE e o XML vão para ele pelo e-mail do escritório.
- **Quem vê**: quem tem a permissão de emitir NF-e da empresa (o empresário, por padrão) e a equipe. Configurar a emissão e anexar as guias é só da equipe; ligar exige a autorização do cliente registrada.
- **Sem inteligência artificial**: a nota é calculada e montada por regras fixas do leiaute oficial e das operações cadastradas pelo escritório; nenhum dado vai para serviço de IA.
- **Demonstração**: não tem certificado; a emissão fica desligada, nada é enviado e o produtor rural de exemplo é fictício.

## 19. Gestão da loja (caixa, vendas e estoque)

- **Onde roda**: dentro do portal e do banco de dados. **Nada é enviado** à SEFAZ, a adquirentes, a bancos, a serviços externos ou a inteligência artificial. O comprovante é **não fiscal** (traz "NÃO É DOCUMENTO FISCAL"); a NF-e de uma venda só sai pelo módulo de NF-e, com o certificado digital, quando ligado pelo escritório. A NFC-e fica **desconectada** até o credenciamento da empresa na SEFAZ-TO e o cadastro do CSC.
- **O que guarda**: produtos (descrição, NCM, preços, custos, medidas e estoque), movimentos do estoque, caixas (abertura, sangrias, suprimentos, contagem do fechamento), vendas e orçamentos (itens, valores, forma de pagamento, parcelas e vendedor) e, do cliente da venda, o nome, o CPF/CNPJ e o telefone quando informados — os mesmos dados do cadastro de clientes do Financeiro. Não guarda número de cartão.
- **Quem vê**: só pessoas da própria empresa com a permissão "Vender no caixa" ou "Gerenciar a loja", e a equipe vinculada à empresa. Clientes de outras empresas não veem nada (regra no banco, além da tela). O balconista não cancela vendas, não mexe no estoque nem nas configurações.
- **Integração contábil**: cada venda vira lançamento no Financeiro (à vista como recebido na conta configurada, a prazo como conta a receber por parcela); sangrias com conta escolhida viram transferências. O cancelamento devolve o estoque e cancela os lançamentos.
- **Planilha de produtos e entrada pelas notas de compra**: a planilha enviada é lida **no servidor do portal**, só na memória (o arquivo não é guardado nem enviado a ninguém); só os produtos conferidos são gravados. Os **vínculos** “código do fornecedor → produto da loja” (CNPJ do fornecedor, código e descrição do item na nota, fator de conversão) ficam no banco, visíveis só a quem gerencia a loja e à equipe. A **entrada automática** é desligada por padrão e roda no próprio portal quando a nota de compra chega; o aviso ao dono fica no sininho do portal.
- **Rentabilidade da frota**: caminhões (placa, descrição, custos fixos), viagens (CT-e, rota, cliente, mercadoria, nome do motorista, valores) e despesas (fornecedor, litros, km, valores) ficam no banco do portal, visíveis só a quem vê o financeiro da empresa e à equipe vinculada. Os cálculos e o PDF são feitos no servidor do portal, sem serviço externo.
- **Importar a nota de compra (XML ou PDF)**: o arquivo é lido **no servidor do portal**, sem serviço externo nem inteligência artificial (o PDF é lido pela posição do texto no DANFE). O **XML** fica guardado nos documentos da empresa, como um envio comum (com quem enviou), para o escritório. O **PDF não é guardado**: ficam só os dados lidos da nota (chave de acesso, número, série, CNPJ e nome do fornecedor, data, valor e os itens) na tabela das notas lançadas pelo PDF, visível só a quem gerencia a loja e à equipe, para a mesma nota não entrar duas vezes. A margem dos produtos novos fica na configuração da loja.

## 20. Ordens de carregamento (gestão de notas e transporte)

- **Onde roda**: dentro do portal e do banco de dados. A ordem e o PDF são gerados no próprio portal; **nada é enviado** a transportadoras, balanças, SEFAZ, ANTT ou serviços externos, nem a inteligência artificial. Só quando a pessoa emite a NF-e da ordem é que a placa, a UF, o RNTRC e a transportadora vão à SEFAZ, dentro da própria nota (seção 18).
- **O que guarda**: comprador e locais de carregamento e descarga, produto, quantidade, preço, contrato, frete, transportadora (nome, CNPJ/CPF e RNTRC), **motorista (nome e CPF)**, placas do caminhão e das carretas, pesagem (bruto, tara, líquido, umidade, impureza e ticket), quem criou e quem cancelou. O CPF do motorista serve para conferir quem vai carregar; não é usado para outra finalidade.
- **Quem vê**: só pessoas da própria empresa com a permissão "Emitir nota de produto" e a equipe vinculada à empresa. Clientes de outras empresas não veem nada (regra no banco, além da tela). Ninguém altera a tabela diretamente: tudo passa pelas funções do portal, que conferem a empresa e a situação da ordem.
- **MDF-e e CT-e**: o MDF-e não é emitido pelo portal. O CT-e feito a partir da ordem segue a seção 21.

## 21. Emissão de CT-e (conhecimento de transporte)

- **Serviço externo**: a **SEFAZ autorizadora do CT-e** do estado da transportadora (ex.: SEFAZ-MT) ou a SEFAZ Virtual que atende o estado (SVRS ou SVSP), serviço público oficial, com a conexão protegida pelo certificado digital da empresa. Só recebe dados quando alguém emite um CT-e (ou pede o cancelamento ou a carta de correção) e a emissão está ligada. O **Testar conexão com a SEFAZ** envia só o pedido de status do serviço, sem dados de clientes.
- **O que é transmitido**: o CT-e assinado com o certificado da empresa — dados da transportadora (CNPJ, inscrição estadual, endereço, RNTRC), do remetente, do destinatário e de quem paga o frete (CNPJ/CPF, inscrição estadual, endereço, telefone e e-mail do cadastro), o trajeto, os valores do frete e os impostos, a carga (produto, peso e valor) e as **chaves das NF-e** transportadas; o CNPJ do escritório como autorizado a baixar o XML (se ligado) e o responsável técnico. Nos eventos, a chave do CT-e, o motivo do cancelamento ou os campos corrigidos.
- **Preencher pela NF-e**: o portal lê o XML da nota que **já está no portal** da própria empresa (emitida, enviada ou trazida pela busca automática). Nada é consultado fora do portal; os participantes que faltam são cadastrados no cadastro de clientes da empresa.
- **O que fica no portal**: o pedido, os dados calculados, o XML assinado e o autorizado e os eventos; em produção, o registro nos documentos fiscais da empresa.
- **Quem vê**: quem tem a permissão de emitir CT-e da empresa (o empresário, por padrão) e a equipe. Configurar a emissão é só da equipe; ligar exige o certificado válido e a autorização do cliente registrada. Clientes de outras empresas não veem nada (regra no banco, além da tela).
- **Sem inteligência artificial**: o CT-e é calculado e montado por regras fixas do leiaute oficial e das operações do frete cadastradas pelo escritório; nenhum dado vai para serviço de IA.
- **Demonstração**: não tem certificado; a emissão fica desligada (o formulário só confere os valores), nada é enviado e as empresas são fictícias.

## 22. Gestão do hotel (reservas e hóspedes)

- **Onde roda**: tudo dentro do portal. **Nada é enviado** a sites de reserva (Booking, Expedia...), ao Ministério do Turismo, a serviços externos ou a inteligência artificial. A origem da reserva é só um rótulo informado pela recepção.
- **O que guarda**: a ficha de cada hóspede (os dados pedidos na FNRH) e os acompanhantes, as reservas e estadias, a conta (diárias, consumo, serviços, descontos) e os pagamentos — sem número de cartão. Cada pagamento vira lançamento no Financeiro da empresa.
- **Quem vê**: só pessoas da própria empresa com a permissão "Vender no caixa" (recepção) ou "Gerenciar a loja" (gerente) e a equipe vinculada à empresa. Clientes de outras empresas não veem nada (regra no banco, além da tela). Ninguém altera as tabelas diretamente: tudo passa pelas funções do portal, que conferem a empresa, a permissão e a situação da reserva; as alterações ficam no registro de atividades.
- **Comprovantes dos recebimentos** (foto do PIX, do comprovante do cartão ou da transferência, ou PDF): ficam num armazenamento privado, na pasta da empresa, separado dos documentos enviados ao escritório. O arquivo vai direto do aparelho ao armazenamento por um link temporário criado depois da validação (formato, até 10 MB, permissão e o recebimento), e o portal confere o tipo real do arquivo antes de aceitar. Para abrir, o portal gera um link de 2 minutos. Só a recepção e o gerente do hotel da própria empresa veem; a foto não é lida por leitura automática (OCR), não é enviada a serviços externos nem usada para treinar inteligência artificial. A foto tirada no celular é reduzida no próprio aparelho antes do envio.
- **Ficha de registro (FNRH)**: sai em PDF para conferência e assinatura. O envio ao sistema do Ministério do Turismo é feito pelo próprio hotel, fora do portal.
- **Exclusão**: o gerente exclui o cadastro de quem não tem hospedagem registrada. A ficha de quem se hospedou fica guardada junto com a hospedagem, pelo prazo da obrigação legal.
- **Demonstração**: o hotel, os hóspedes (CPF gerado só para teste), as reservas e os pagamentos da demonstração são fictícios.
