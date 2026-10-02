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
| **Provedor de e-mail (SMTP)** — escolhido pelo escritório | operador | convites, avisos e lembretes por e-mail | e-mail do destinatário, assunto e texto do aviso (com link para o portal). **Documentos não são anexados** | conforme o provedor | desconectado até o escritório informar as credenciais; cada pessoa pode desligar os avisos por e-mail em **Minha conta** |
| **WhatsApp Business Platform** (Meta) | operador | lembretes de documentos pendentes e avisos ao cliente (documento ou relatório publicado, mensagem e solicitação do escritório) | número de WhatsApp do contato ou do usuário cliente e o texto do modelo aprovado: nome da empresa, mês, quantidade de pendências ou o título curto do aviso (ex.: nome do documento ou assunto da mensagem) e link do portal. **Documentos e o conteúdo das mensagens não são enviados** | conforme a Meta | desconectado até haver token, número e modelo aprovado; lembretes só para os contatos marcados com “recebe lembretes”; avisos só para clientes que autorizaram (registro na auditoria), com desativação a qualquer momento em **Minha conta → Avisos**; avisos seguidos reunidos numa única mensagem e dispensados se já vistos no portal |
| **Serviços de notificação dos navegadores** — Google (Firebase Cloud Messaging), Apple (Apple Push Notification service), Mozilla (Push Service) e Microsoft (Windows Push Notification Services), conforme o navegador de cada pessoa | operador | entregar os avisos do portal no celular ou no computador de quem ativou | o **conteúdo cifrado de ponta a ponta** (o serviço não consegue ler): título e texto curto do aviso (ex.: nome da empresa, nome do arquivo, mês e quem enviou) e o caminho da página do portal. O serviço vê apenas o endereço de entrega do aparelho, o horário e o tamanho da mensagem | conforme o serviço do navegador | só funciona para quem ativou, aparelho por aparelho; nenhum documento é enviado; o aviso só vai para aparelhos com a sessão ativa; endereços cancelados são apagados; desativação a qualquer momento em **Minha conta → Avisos** |
| **BrasilAPI** (projeto comunitário de código aberto) e, se ela estiver fora do ar, **Minha Receita** (mesma base) | — | buscar os dados públicos do CNPJ no cadastro de empresas (dados abertos da Receita Federal) | **apenas o número do CNPJ** digitado pela equipe, enviado pelo servidor do portal (o navegador não fala com esses serviços); nenhum dado de usuário ou de cliente | serviços na internet | só quando a equipe clica na lupa do CNPJ; os dados que voltam são públicos (cadastro aberto da Receita, inclusive o quadro de sócios) e são conferidos antes de salvar; o retrato da consulta fica guardado com a empresa |
| **jsDelivr** (rede de distribuição) | — | download do modelo público do idioma português usado pelo OCR | **nenhum dado de cliente** (apenas o servidor baixa um arquivo público) | global | pode ser evitado informando `OCR_CAMINHO_IDIOMAS` |
| **GitHub** | — | guarda o código-fonte do portal | **nenhum dado de cliente** | — | repositório do escritório; segredos nunca vão para o repositório |
| **ClamAV** (opcional, servidor do escritório) | — | varredura antivírus dos arquivos enviados | o arquivo, para verificação, sem armazenamento | servidor indicado pelo escritório | desconectado até ser configurado |
| **SEFAZ — Ambiente Nacional da NF-e** e **Ambiente de Dados Nacional da NFS-e** (Receita Federal / SERPRO) | — (órgãos públicos; os documentos são da própria empresa) | **notas automáticas**: buscar as notas fiscais da empresa e, se ela ativar, registrar a ciência da emissão das NF-e recebidas | o CNPJ e a UF da empresa e o número da última nota recebida (NSU); o **certificado digital da empresa é apresentado na conexão** (autenticação TLS — a chave privada nunca é enviada); na ciência, o evento assinado com a chave da nota, o CNPJ e a data e hora | Brasil (serviços nacionais) | desligado em cada empresa até o certificado ser cadastrado, com a autorização do cliente registrada; consultas limitadas às regras da SEFAZ; nenhum outro dado é enviado; na demonstração as consultas ficam desligadas |
| **Outros órgãos públicos** | — | obrigações legais dos serviços contábeis | conforme a legislação | — | fora as notas automáticas, o portal não consulta nem envia nada a órgãos públicos |

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
| Auditoria | quem fez o quê e quando | obrigação legal; legítimo interesse |

## 5. Medidas de segurança

- **Isolamento por empresa** no banco (Row Level Security) e verificação de permissão no servidor e na interface; testes automáticos garantem que um cliente não acessa dados de outro.
- **Permissões por empresa e por operação** (ver, enviar, baixar, aprovar, editar o financeiro, publicar relatórios…). Os dados de colaboradores e a previsão de impostos só aparecem para quem tem a permissão de cálculos da empresa (por padrão, o empresário titular e o escritório).
- **Senhas** fortes guardadas somente pelo Supabase Auth; **verificação em duas etapas** disponível para todos e que pode ser exigida pelo escritório.
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

- **Onde roda**: dentro do portal (processador da fila), sobre os relatórios de vendas (CSV ou Excel) enviados em Documentos. **Nada é enviado** às adquirentes, a serviços externos ou a inteligência artificial, e nenhuma adquirente é consultada: a conexão direta (EDI ou API) fica **desconectada** até ser ativada com a autorização de cada empresa.
- **O que guarda**: de cada venda, a data, a bandeira, a modalidade, as parcelas, os valores (bruto, taxa e líquido), o NSU, o código de autorização, o terminal e a previsão de pagamento — não guarda número de cartão nem dados de quem comprou (as outras colunas ficam só no arquivo original, em Documentos). As primeiras 5 linhas do relatório, como vieram no arquivo, ficam guardadas para a conferência das colunas. Guarda também os contratos e taxas cadastrados e os formatos aprendidos (só os nomes e as posições das colunas, sem dados de vendas).
- **Quem vê**: a equipe vinculada à empresa e, no cliente, quem tem a permissão "Conferência das taxas" (o empresário, por padrão). Cadastrar contratos, conferir colunas e excluir relatórios exige "Contratos e relatórios". O formato aprendido pela equipe vale para todo o escritório; o aprendido pelo cliente, só para a empresa dele.
- **Registro**: contratos, taxas, conferência das colunas, importações, exclusões e cada download da planilha ficam no registro de atividades.
