# Privacidade e serviços externos

Registro, em linguagem simples, de **quais serviços de fora participam do funcionamento do portal, quais dados cada um recebe e como estão configurados** — base para a política de privacidade e para o atendimento à LGPD (Lei nº 13.709/2018).

Controladora dos dados: **GUARESE'S ON SOLUCOES EMPRESARIAIS LTDA** (CNPJ 62.935.399/0001-50), Praça do Centenário, nº 713, Centro, Porto Nacional – TO, CEP 77.500-000 — contato: onguaresescontato@gmail.com.

## 1. Resumo

- Os dados ficam no **Supabase**, na região de **São Paulo**, com criptografia em trânsito e em repouso.
- O site roda na **Vercel**, também na região de **São Paulo**.
- E-mail e WhatsApp só funcionam quando o escritório os configura; enquanto isso ficam **desconectados** e nada é enviado.
- **Nenhum dado ou documento de cliente é enviado a serviços de inteligência artificial**, nem usado para treinar modelos. A leitura de imagens (OCR) acontece dentro do próprio servidor do portal.
- O navegador dos usuários só se comunica com o endereço do portal e com o Supabase (a política de segurança de conteúdo do site bloqueia qualquer outro destino). As fontes e ícones são servidos pelo próprio portal.

## 2. Serviços externos

| Serviço | Papel (LGPD) | Para que é usado | Dados que recebe | Onde | Configurações de privacidade |
| --- | --- | --- | --- | --- | --- |
| **Supabase** (Supabase Inc.) | operador | banco de dados, login (senhas e verificação em duas etapas) e armazenamento dos arquivos | todos os dados do portal: cadastros, documentos, lançamentos, mensagens, registros de acesso | região `sa-east-1` (São Paulo) | regras de acesso por linha (RLS) em todas as tabelas; arquivos em armazenamento **privado** entregues por links temporários de 2 minutos; cadastro público desligado; senhas guardadas apenas pelo serviço de autenticação; chave secreta só no servidor |
| **Vercel** (Vercel Inc.) | operador | hospedagem do site e execução do servidor (páginas, relatórios, leitura de arquivos) | as requisições dos usuários (inclui IP e navegador); arquivos ficam **só na memória**, durante a leitura automática ou a geração de relatórios | funções na região `gru1` (São Paulo); conteúdo estático (páginas sem dados) em rede de distribuição | respostas com dados não são guardadas em cache (`no-store`); variáveis secretas marcadas como protegidas; registros técnicos por tempo limitado conforme o plano |
| **Provedor de e-mail (SMTP)** — escolhido pelo escritório | operador | convites, avisos e lembretes por e-mail | e-mail do destinatário, assunto e texto do aviso (com link para o portal). **Documentos não são anexados** | conforme o provedor | desconectado até o escritório informar as credenciais; cada pessoa pode desligar os avisos por e-mail em **Minha conta** |
| **WhatsApp Business Platform** (Meta) | operador | lembretes de documentos pendentes | número de WhatsApp do contato da empresa e o texto do modelo aprovado: nome da empresa, mês, quantidade de pendências e link do portal | conforme a Meta | desconectado até haver token, número e modelo aprovado; só recebem os contatos marcados com “recebe lembretes” |
| **Serviços de notificação dos navegadores** — Google (Firebase Cloud Messaging), Apple (Apple Push Notification service), Mozilla (Push Service) e Microsoft (Windows Push Notification Services), conforme o navegador de cada pessoa | operador | entregar os avisos do portal no celular ou no computador de quem ativou | o **conteúdo cifrado de ponta a ponta** (o serviço não consegue ler): título e texto curto do aviso (ex.: nome da empresa, nome do arquivo, mês e quem enviou) e o caminho da página do portal. O serviço vê apenas o endereço de entrega do aparelho, o horário e o tamanho da mensagem | conforme o serviço do navegador | só funciona para quem ativou, aparelho por aparelho; nenhum documento é enviado; o aviso só vai para aparelhos com a sessão ativa; endereços cancelados são apagados; desativação a qualquer momento em **Minha conta → Avisos** |
| **jsDelivr** (rede de distribuição) | — | download do modelo público do idioma português usado pelo OCR | **nenhum dado de cliente** (apenas o servidor baixa um arquivo público) | global | pode ser evitado informando `OCR_CAMINHO_IDIOMAS` |
| **GitHub** | — | guarda o código-fonte do portal | **nenhum dado de cliente** | — | repositório do escritório; segredos nunca vão para o repositório |
| **ClamAV** (opcional, servidor do escritório) | — | varredura antivírus dos arquivos enviados | o arquivo, para verificação, sem armazenamento | servidor indicado pelo escritório | desconectado até ser configurado |
| **Órgãos públicos** | — | obrigações legais dos serviços contábeis | conforme a legislação | — | o portal **não** consulta nem envia nada à SEFAZ ou a outros órgãos |

## 3. Inteligência artificial

- O portal **não usa** serviços de inteligência artificial externos.
- Sugestões de conciliação, classificação de lançamentos, leitura de XML e os resumos em texto dos relatórios são calculados por **regras fixas** dentro do próprio portal.
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
| Auditoria | quem fez o quê e quando | obrigação legal; legítimo interesse |

## 5. Medidas de segurança

- **Isolamento por empresa** no banco (Row Level Security) e verificação de permissão no servidor e na interface; testes automáticos garantem que um cliente não acessa dados de outro.
- **Permissões por empresa e por operação** (ver, enviar, baixar, aprovar, editar o financeiro, publicar relatórios…).
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

