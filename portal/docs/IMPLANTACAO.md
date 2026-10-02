# Como publicar o Portal Guarese's ON

Este guia explica, em linguagem simples, como colocar o portal no ar. Quase tudo é feito por um script automático; a pessoa do escritório só precisa **criar as contas, entrar nelas e gerar duas chaves de acesso**.

---

## 1. Como funciona, em uma figura

```
Cliente / equipe (navegador ou celular)
          │
          ▼
   Vercel — o site (região São Paulo)
          │
          ▼
   Supabase — banco de dados, login e arquivos (região São Paulo)
```

- **GitHub** guarda o código do portal (já está lá).
- **Vercel** é onde o site fica hospedado. É ela que abre as páginas e gera os relatórios.
- **Supabase** guarda as informações (empresas, lançamentos, documentos), cuida do login e das senhas e armazena os arquivos.

## 2. Dois ambientes, sempre separados

| | Demonstração | Produção (uso real) |
| --- | --- | --- |
| Para quê | mostrar e testar | atender os clientes de verdade |
| Dados | **fictícios** (empresas “DEMO”, e-mails `.test`) | **reais** |
| Aviso no topo | faixa “Ambiente de demonstração” | sem faixa |
| Site (Vercel) | `portal-guareses-on` → https://portal-guareses-on.vercel.app | `portal-guareses-on-producao` (ou domínio próprio) |
| Banco (Supabase) | `portal-guareses-on-demo` | `portal-guareses-on-producao` |
| Comando | `publicar.ts` | `publicar.ts --producao` |

Os dados fictícios **nunca** são criados no ambiente de produção: o script de dados de demonstração se recusa a rodar quando o ambiente é de produção.

## 3. Contas necessárias

| Conta | Onde criar | Para quê |
| --- | --- | --- |
| GitHub | https://github.com | guarda o código (já existe: `guaresesouzacontabilidade/guarese-e-souza-contabilidade`) |
| Supabase | https://supabase.com/dashboard (entrar com o GitHub) | banco de dados, login e arquivos |
| Vercel | https://vercel.com/signup (entrar com o GitHub) | hospedagem do site |

## 4. Quanto custa

Valores aproximados na data deste guia — confira sempre as páginas oficiais (https://supabase.com/pricing e https://vercel.com/pricing), porque os planos mudam.

**Demonstração: R$ 0.** Os planos gratuitos bastam.

- Supabase Free: até 2 projetos ativos, 500 MB de banco e 1 GB de arquivos. Um projeto sem uso por 7 dias é **pausado** (os dados ficam guardados; basta clicar em “Restore” no painel do Supabase para voltar).
- Vercel Hobby: gratuito, mas destinado a uso **pessoal e não comercial**.

**Produção (uso real com clientes): recomendamos os planos pagos.**

- **Supabase Pro** (cerca de US$ 25 por mês): sem pausa automática, cópias de segurança diárias, mais espaço (8 GB de banco e 100 GB de arquivos) e limites de sessão.
- **Vercel Pro** (cerca de US$ 20 por mês por pessoa com acesso ao painel): exigido pelos termos da Vercel para uso comercial.
- **E-mail (SMTP)**: há serviços com plano gratuito para poucos envios por dia; veja `CONFIGURACAO.md`.
- **Domínio próprio** (opcional, ex.: `portal.seudominio.com.br`): o registro `.com.br` no Registro.br custa cerca de R$ 40 por ano.

A assinatura do Claude não é usada pelo portal no dia a dia: depois de publicado, o portal funciona sozinho.

## 5. Publicar a demonstração

### 5.1 O que a pessoa do escritório faz (só contas e chaves)

1. Entrar no **Supabase** com a conta do escritório.
2. Gerar a chave de acesso do Supabase:
   - abrir https://supabase.com/dashboard/account/tokens
   - clicar em **Generate new token** (token pessoal, acesso completo — *não* use o token com escopo limitado);
   - dar um nome (ex.: `publicacao-portal`) e copiar o valor.
3. Entrar na **Vercel** com a conta do escritório.
4. Gerar a chave de acesso da Vercel:
   - abrir https://vercel.com/account/settings/tokens
   - **Create Token**, escopo da conta pessoal, validade curta (ex.: 1 dia), copiar o valor.
5. Guardar as duas chaves **nas variáveis de ambiente do ambiente do Claude Code** (nunca colar no chat):
   - `SUPABASE_ACCESS_TOKEN` = chave do Supabase
   - `VERCEL_TOKEN` = chave da Vercel

### 5.2 O que o script faz sozinho

```bash
cd portal
npm ci
NODE_USE_ENV_PROXY=1 npx tsx scripts/publicar.ts
```

1. Cria o projeto no Supabase (região São Paulo) e espera ficar pronto.
2. Cria as tabelas, as regras de acesso de cada cliente e as funções do banco.
3. Configura o login: **cadastro público desligado** (só entra quem for convidado), senha forte (mínimo de 10 caracteres com maiúsculas, minúsculas e números), verificação em duas etapas disponível, endereços do site autorizados e e-mails em português.
4. Cria o projeto na Vercel, cadastra as configurações (as chaves secretas ficam marcadas como protegidas) e publica o site.
5. Agenda as rotinas automáticas no banco: fila de tarefas a cada 5 minutos e rotina diária às 6h05.
6. Cria os dados fictícios e confere se o site está no ar.

No final aparecem o endereço do site e a senha dos usuários de teste (`admin@`, `contador@`, `cliente@`, `cliente2@` e `colaborador@demo.guareses.test`). O script pode ser executado de novo sem problemas: ele reaproveita o que já existe, aplica só as mudanças novas do banco e **mantém as senhas dos usuários de teste** que já existem (para trocar, use `--senha-demo "NovaSenha"`).

Se a chave do Supabase não listar as organizações da conta (acontece com alguns tipos de chave), o script usa a organização de um projeto existente; para escolher outra, informe a variável `SUPABASE_ORG_ID`.

### 5.3 Depois de publicar

- **Apague as duas chaves** (elas não são mais necessárias):
  - Supabase: https://supabase.com/dashboard/account/tokens → excluir;
  - Vercel: https://vercel.com/account/settings/tokens → excluir.
- Na demonstração, “Esqueci minha senha” só envia e-mails para quem é membro da conta do Supabase (limite do e-mail padrão do Supabase). Os usuários de teste não precisam disso.

## 6. Publicar a produção (dados reais)

Quando o escritório decidir usar com clientes de verdade:

1. (Recomendado) Assinar o Supabase Pro e o Vercel Pro — seção 4.
2. Gerar novamente as duas chaves (seção 5.1).
3. Executar:

   ```bash
   cd portal
   NODE_USE_ENV_PROXY=1 npx tsx scripts/publicar.ts --producao --admin-email guaresesouzacontabilidade@gmail.com --admin-nome "Nome do administrador"
   ```

   Com domínio próprio, acrescente `--dominio portal.seudominio.com.br` e, no Registro.br, crie um registro **CNAME** apontando para `cname.vercel-dns.com`.

4. O script mostra um **link de uso único** (válido por 24 horas) para o administrador criar a senha.
5. Apague as duas chaves.

### Primeiro acesso em produção — lista de conferência

1. Abrir o link, criar a senha e entrar.
2. **Minha conta → Verificação em duas etapas → Ativar agora** (use Google Authenticator ou Microsoft Authenticator).
3. **Configurações → Escritório**: conferir os dados (a logomarca oficial já vem aplicada).
4. **Configurações → Segurança**: marcar “verificação em duas etapas obrigatória para a equipe”.
5. **Configurações → Integrações**: configurar o e-mail (SMTP) e usar “Enviar e-mail de teste para mim”. Configurar o mesmo SMTP no Supabase (**Authentication → Emails → SMTP Settings**) para que “Esqueci minha senha” chegue a qualquer pessoa.
6. **Equipe e permissões**: convidar a equipe e vincular cada pessoa às empresas que atende.
7. **Empresas → Nova empresa**: cadastrar as empresas, as contas bancárias e convidar o empresário de cada uma.
8. Conferir em **Configurações → Integrações** se “Rotinas automáticas” aparece como “Funcionando” depois de alguns minutos.
9. **Obrigações e prazos → Atualizações normativas**: conferir a fonte de cada regra do catálogo inicial, **validar** e **aplicar** (sem isso, nenhum prazo é calculado). Depois, cadastrar em **Catálogo** as regras de ICMS/ISS do estado e dos municípios atendidos e, em **Feriados**, os feriados municipais — sempre com a lei de origem.
10. **Minha conta → Avisos**: escolher de quais empresas quer ser avisado quando um cliente enviar arquivos e tocar em **Ativar neste aparelho** no celular e no computador (no iPhone, antes, **Adicionar à Tela de Início** pelo Safari). Conferir com **Enviar aviso de teste**. As chaves das notificações já são criadas pelo script de publicação.

## 7. Atualizações

Quando houver uma nova versão do portal no GitHub, basta executar o mesmo comando de publicação (com `--producao` para o ambiente real). O script aplica somente as mudanças novas do banco e publica o site de novo; os dados existentes são preservados.

## 8. Cópias de segurança

- **Supabase Pro**: cópias diárias automáticas (restauração pelo painel: **Database → Backups**).
- **Plano gratuito**: não há cópia automática para baixar. Para uma cópia manual do banco: `npx supabase db dump --db-url "<conexão do projeto>" -f copia.sql` (a conexão fica em **Project Settings → Database**). Os arquivos ficam em **Storage**.
- Os documentos dos clientes também devem seguir a política de guarda do escritório (**Configurações → Privacidade**).

## 9. Se algo der errado

| Situação | O que fazer |
| --- | --- |
| Site mostra erro de conexão / projeto pausado | No Supabase, abrir o projeto e clicar em **Restore project** (plano gratuito pausa após 7 dias sem uso). |
| Convites não chegam por e-mail | Sem SMTP o portal mostra o link para copiar e enviar por WhatsApp. Configure o SMTP (seção 6, item 5). |
| “Rotinas automáticas” em “Verificar” | Confira se o projeto do Supabase está ativo e execute a publicação de novo (ela reagenda as rotinas). |
| Pessoa não consegue entrar | Em **Equipe e permissões**, abra a pessoa e use **Gerar novo link de acesso**; confira se o acesso não está desativado. |
| Perdeu o celular com o autenticador | Um administrador abre a pessoa em **Equipe e permissões** e usa **Redefinir duas etapas**; no próximo acesso ela cadastra o autenticador de novo. Se for o único administrador, peça ajuda técnica: a redefinição é feita no painel do Supabase (**Authentication → Users → MFA**). |
