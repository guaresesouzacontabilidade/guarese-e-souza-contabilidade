# Estudo: o que um sistema de clínica de fisioterapia precisa

Resumo do levantamento feito para a gestão da clínica de fisioterapia no Portal Guarese's ON, com o que já está pronto (✅) e o que fica para uma próxima etapa (⏳).

## 1. Agenda
- ✅ Agenda por fisioterapeuta (cor de cada um), por dia e semana, com sala ou box.
- ✅ Tipos: avaliação, sessão, reavaliação, grupo (pilates, hidro) e domiciliar.
- ✅ Sessões repetidas (ex.: seg, qua e sex por 4 semanas), que entram no pacote do paciente.
- ✅ Não deixa marcar dois pacientes no mesmo horário do mesmo fisioterapeuta (grupo pode).
- ✅ Confirmação pelo WhatsApp da própria clínica (mensagem pronta), "chegou", falta com motivo, cancelamento (inclusive da repetição inteira).
- ✅ Primeira vez sem cadastro: agenda só com nome e telefone.
- ✅ Taxa de faltas do mês no painel.
- ⏳ Lembrete automático no dia anterior, lista de espera e agendamento on-line pelo próprio paciente.

## 2. Cadastro do paciente
- ✅ A identificação que o prontuário exige (Res. COFFITO nº 414/2012, art. 1º, § 1º, I): nome, naturalidade, estado civil, gênero, nascimento, profissão e endereço.
- ✅ Convênio e carteirinha, médico que encaminhou, responsável (menor de idade), contato de emergência.
- ✅ Autorização para o uso dos dados de saúde (LGPD, art. 11), com a data e quem registrou.

## 3. Prontuário (Res. COFFITO nº 414/2012)
- ✅ **Avaliação**: história clínica, exame físico-funcional (dor de 0 a 10, amplitude, força, testes especiais), exames complementares, **diagnóstico e prognóstico fisioterapêuticos** (com a CID do pedido médico) e **plano terapêutico** (objetivos, recursos e técnicas, frequência e número provável de sessões).
- ✅ **Evolução de cada sessão** no formato SOAP, com a dor antes e depois, os recursos usados (TENS, terapia manual, pilates...) e as intercorrências.
- ✅ Gráfico da dor ao longo do tratamento.
- ✅ **Alta** com o motivo, o resultado e as recomendações.
- ✅ Cada registro leva o nome, o **CREFITO** e a data e hora (art. 1º, VIII, e art. 2º).
- ✅ Registro finalizado não muda: correções entram como **adendo** datado. Nada é apagado (guarda mínima de 5 anos, art. 6º).
- ✅ **Sigilo** (art. 3º e 4º): só os fisioterapeutas da clínica leem. A recepção e o escritório de contabilidade não veem, e o banco de dados também bloqueia.
- ⏳ Anexar exames (foto ou PDF), escalas prontas (Oswestry, DASH, Berg com cálculo automático), prescrição de exercícios com vídeo e assinatura digital ICP-Brasil.

## 4. Documentos
- ✅ Declaração de comparecimento, relatório fisioterapêutico, encaminhamento, orientações para casa e declaração, com o timbre da clínica e o CREFITO; impressão ou PDF.

## 5. Pacotes e convênios
- ✅ Pacote com o número de sessões, o valor, a validade e a guia/autorização do convênio; sessões usadas, agendadas e restantes; aviso de pacote acabando.
- ⏳ Faturamento de convênio no padrão **TISS** da ANS (guias em XML para a operadora) e controle de glosas.

## 6. Financeiro
- ✅ Recebimentos (PIX, dinheiro, cartão, transferência ou a receber) que viram lançamentos no **Financeiro** do portal e chegam prontos para a contabilidade.
- ✅ Estorno pelo responsável.
- ✅ **Repasse** mensal por fisioterapeuta (percentual sobre o valor das sessões realizadas).
- ⏳ Lançar o pagamento do repasse sozinho como despesa.

## 7. Impostos e obrigações (onde o escritório faz a diferença)
- **Nota fiscal de serviço (NFS-e)**: já existe no portal (Notas → Emitir nota de serviço).
- **Simples Nacional**: a fisioterapia fica no **Anexo III** quando a folha de salários (incluindo o pró-labore) chega a **28% do faturamento** (Fator R); abaixo disso vai para o **Anexo V**, bem mais caro (LC 123/2006, art. 18, § 5º-B, XVI, e § 5º-M). O robô tributário do portal já acompanha o Fator R.
- **DMED** (clínica com CNPJ): declaração anual à Receita Federal dos valores recebidos de cada paciente, entregue até o fim de fevereiro. Os recebimentos do portal já têm o paciente e o valor.
- **Fisioterapeuta autônomo (CPF)**: recibo pelo **Receita Saúde** (aplicativo da Receita Federal, obrigatório desde 2025) e carnê-leão.
- **ISS** do município sobre os serviços.

## 8. Segurança e privacidade
- Dados de saúde são **dados sensíveis** (LGPD). Cada clínica só vê os próprios dados.
- O prontuário fica fora da trilha de auditoria do escritório.
- Senhas ficam com o provedor de login, e o controle de acesso funciona no servidor e no banco.
