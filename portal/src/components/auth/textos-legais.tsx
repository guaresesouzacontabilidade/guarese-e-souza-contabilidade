/** Textos da política de privacidade e dos termos de uso (LGPD). */

export function PoliticaPrivacidade() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground/90 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <p>
        Esta política explica como a <strong>GUARESE&apos;S ON SOLUCOES EMPRESARIAIS LTDA</strong> (CNPJ 62.935.399/0001-50),
        nome fantasia GUARESE&apos;S ON CONTABILIDADE, trata dados pessoais no Portal Guarese&apos;s ON, em conformidade com a Lei
        Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>
      <h3>1. Quais dados tratamos</h3>
      <ul>
        <li>Dados de acesso: nome, e-mail, telefone, cargo, registros de acesso (data, hora, IP e navegador).</li>
        <li>Documentos e informações enviados pelas empresas clientes: notas fiscais, extratos, comprovantes, folha de pagamento, contratos e demais documentos contábeis, que podem conter dados pessoais de sócios, empregados, clientes e fornecedores.</li>
        <li>Dados financeiros e contábeis das empresas atendidas.</li>
      </ul>
      <h3>2. Para que usamos</h3>
      <ul>
        <li>Prestação dos serviços contábeis, fiscais, trabalhistas e de gestão financeira contratados (execução de contrato).</li>
        <li>Cumprimento de obrigações legais e regulatórias (fiscais, contábeis, trabalhistas e previdenciárias).</li>
        <li>Segurança do portal, prevenção a fraudes e registro de auditoria (legítimo interesse e obrigação legal).</li>
        <li>Comunicações sobre documentos, pendências, prazos e relatórios.</li>
      </ul>
      <h3>3. Compartilhamento e operadores</h3>
      <ul>
        <li>Supabase (banco de dados, autenticação e armazenamento de arquivos, na região de São Paulo), contratado como operador, com criptografia em trânsito e em repouso.</li>
        <li>
          Vercel (hospedagem do site, na região de São Paulo), contratada como operadora: executa o portal e processa temporariamente os arquivos durante a leitura
          automática e a geração de relatórios, sem guardá-los; mantém registros técnicos de acesso (como endereço IP) por período limitado.
        </li>
        <li>Provedor de e-mail configurado pelo escritório, somente para envio de notificações e convites.</li>
        <li>WhatsApp Business Platform (Meta), somente se o escritório ativar os lembretes por WhatsApp — são enviados apenas o número do contato e o texto do lembrete.</li>
        <li>
          SEFAZ (Ambiente Nacional da NF-e) e Ambiente de Dados Nacional da NFS-e, somente se a empresa cadastrar o certificado digital e autorizar a busca
          automática de notas: o portal apresenta o certificado da empresa na conexão e informa o CNPJ e o número da última nota recebida; se a empresa ativar,
          registra a ciência da emissão das notas recebidas. A senha do certificado não é guardada e a chave fica cifrada, usada só pelo servidor.
        </li>
        <li>Órgãos públicos, quando exigido por lei, no contexto dos serviços contábeis.</li>
      </ul>
      <h3>4. Inteligência artificial</h3>
      <p>
        Os dados e documentos dos clientes <strong>não são utilizados para treinamento de inteligência artificial</strong>. A leitura
        de textos de imagens e PDFs (OCR) é feita no próprio servidor do portal, sem envio dos documentos a serviços externos.
      </p>
      <h3>5. Armazenamento, segurança e retenção</h3>
      <p>
        Os arquivos ficam em armazenamento privado, acessível apenas por links temporários gerados após verificação de permissão.
        Os dados de cada empresa são isolados no banco de dados. Os documentos são mantidos pelos prazos exigidos pela legislação
        (em regra, ao menos 5 anos para documentos fiscais e contábeis, e prazos maiores para documentos trabalhistas e
        previdenciários) e depois podem ser eliminados conforme a política de retenção configurada pelo escritório.
      </p>
      <h3>6. Seus direitos</h3>
      <p>
        Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação de dados
        desnecessários e informações sobre compartilhamento, além de revogar consentimentos, pela página “Minha conta → Privacidade”
        do portal ou pelo e-mail onguaresescontato@gmail.com. Alguns dados precisam ser mantidos para cumprimento de
        obrigações legais.
      </p>
      <h3>7. Encarregado e contato</h3>
      <p>Contato do encarregado pelo tratamento de dados: onguaresescontato@gmail.com — Praça do Centenário, nº 713, Centro, Porto Nacional – TO, CEP 77.500-000.</p>
    </div>
  );
}

export function TermosUso() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground/90 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <p>Ao utilizar o Portal Guarese&apos;s ON, você concorda com as condições abaixo.</p>
      <h3>1. Acesso</h3>
      <ul>
        <li>O acesso é pessoal e intransferível. Não compartilhe sua senha nem o código de verificação em duas etapas.</li>
        <li>As permissões de cada usuário são definidas pelo escritório e pelo empresário titular, por empresa e por operação.</li>
      </ul>
      <h3>2. Documentos</h3>
      <ul>
        <li>O cliente é responsável pela veracidade, integridade e envio tempestivo dos documentos.</li>
        <li>A “aprovação” de um documento significa apenas a conferência interna pelo escritório e não representa validação fiscal junto aos órgãos públicos.</li>
        <li>Informações extraídas automaticamente de arquivos (XML, OCR) são sugestões sujeitas a conferência humana.</li>
        <li>A presença de protocolo no XML não comprova a regularidade da nota: o portal não confere a situação das notas nos órgãos públicos.</li>
        <li>
          A busca automática de notas só acontece quando a empresa cadastra o certificado digital A1 e autoriza; ela traz apenas os documentos fiscais da própria
          empresa e pode ser desligada a qualquer momento.
        </li>
      </ul>
      <h3>3. Informações financeiras e relatórios</h3>
      <ul>
        <li>Os relatórios são gerenciais e dependem dos documentos e lançamentos disponíveis. Relatórios preliminares podem mudar.</li>
        <li>Quando faltarem dados, o portal sinaliza que o resultado é parcial.</li>
        <li>A visualização de guias e documentos no portal não comprova pagamento.</li>
      </ul>
      <h3>4. Registros</h3>
      <p>Acessos, envios, downloads, alterações e exclusões são registrados para segurança e auditoria.</p>
    </div>
  );
}
