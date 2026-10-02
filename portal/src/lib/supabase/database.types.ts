
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "aceites_termos": {
                  Row: {
                    "aceito_em": string,"id": number,"ip": string | null,"user_agent": string | null,"user_id": string,"versao": string
                  }
                  Insert: {
                    "aceito_em"?: string,"id"?: never,"ip"?: string | null,"user_agent"?: string | null,"user_id": string,"versao": string
                  }
                  Update: {
                    "aceito_em"?: string,"id"?: never,"ip"?: string | null,"user_agent"?: string | null,"user_id"?: string,"versao"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "aceites_termos_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"auditoria": {
                  Row: {
                    "acao": string,"dados_antes": Json | null,"dados_depois": Json | null,"detalhes": Json | null,"empresa_id": string | null,"entidade": string,"entidade_id": string | null,"id": number,"ip": string | null,"ocorrido_em": string,"user_agent": string | null,"user_email": string | null,"user_id": string | null
                  }
                  Insert: {
                    "acao": string,"dados_antes"?: Json | null,"dados_depois"?: Json | null,"detalhes"?: Json | null,"empresa_id"?: string | null,"entidade": string,"entidade_id"?: string | null,"id"?: never,"ip"?: string | null,"ocorrido_em"?: string,"user_agent"?: string | null,"user_email"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "acao"?: string,"dados_antes"?: Json | null,"dados_depois"?: Json | null,"detalhes"?: Json | null,"empresa_id"?: string | null,"entidade"?: string,"entidade_id"?: string | null,"id"?: never,"ip"?: string | null,"ocorrido_em"?: string,"user_agent"?: string | null,"user_email"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"baixas": {
                  Row: {
                    "conciliacao_id": string | null,"conta_financeira_id": string,"created_at": string,"criado_por": string | null,"data_pagamento": string,"desconto": number,"empresa_id": string,"forma_pagamento": string | null,"id": string,"juros": number,"lancamento_id": string,"multa": number,"observacao": string | null,"origem": string,"taxas": number,"tipo": string,"valor_principal": number,"valor_total": number | null
                  }
                  Insert: {
                    "conciliacao_id"?: string | null,"conta_financeira_id": string,"created_at"?: string,"criado_por"?: string | null,"data_pagamento": string,"desconto"?: number,"empresa_id": string,"forma_pagamento"?: string | null,"id"?: string,"juros"?: number,"lancamento_id": string,"multa"?: number,"observacao"?: string | null,"origem"?: string,"taxas"?: number,"tipo": string,"valor_principal": number,"valor_total"?: never
                  }
                  Update: {
                    "conciliacao_id"?: string | null,"conta_financeira_id"?: string,"created_at"?: string,"criado_por"?: string | null,"data_pagamento"?: string,"desconto"?: number,"empresa_id"?: string,"forma_pagamento"?: string | null,"id"?: string,"juros"?: number,"lancamento_id"?: string,"multa"?: number,"observacao"?: string | null,"origem"?: string,"taxas"?: number,"tipo"?: string,"valor_principal"?: number,"valor_total"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "baixas_conciliacao_fk"
      columns: ["empresa_id","conciliacao_id"]
isOneToOne: false
      referencedRelation: "conciliacoes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "baixas_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "baixas_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "baixas_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "baixas_empresa_id_lancamento_id_fkey"
      columns: ["empresa_id","lancamento_id"]
isOneToOne: false
      referencedRelation: "lancamentos"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"categorias_documento": {
                  Row: {
                    "ativo": boolean,"codigo": string,"descricao": string | null,"escritorio": boolean,"extensoes": (string)[],"grupo": string,"nome": string,"ordem": number
                  }
                  Insert: {
                    "ativo"?: boolean,"codigo": string,"descricao"?: string | null,"escritorio"?: boolean,"extensoes": (string)[],"grupo": string,"nome": string,"ordem"?: number
                  }
                  Update: {
                    "ativo"?: boolean,"codigo"?: string,"descricao"?: string | null,"escritorio"?: boolean,"extensoes"?: (string)[],"grupo"?: string,"nome"?: string,"ordem"?: number
                  }
                  Relationships: [
                    
                  ]
                },"categorias_financeiras": {
                  Row: {
                    "ativa": boolean,"codigo": string,"codigo_sistema": string | null,"created_at": string,"empresa_id": string,"id": string,"natureza": string | null,"nome": string,"pai_id": string | null,"sintetica": boolean,"tipo": string,"updated_at": string
                  }
                  Insert: {
                    "ativa"?: boolean,"codigo": string,"codigo_sistema"?: string | null,"created_at"?: string,"empresa_id": string,"id"?: string,"natureza"?: never,"nome": string,"pai_id"?: string | null,"sintetica"?: boolean,"tipo": string,"updated_at"?: string
                  }
                  Update: {
                    "ativa"?: boolean,"codigo"?: string,"codigo_sistema"?: string | null,"created_at"?: string,"empresa_id"?: string,"id"?: string,"natureza"?: never,"nome"?: string,"pai_id"?: string | null,"sintetica"?: boolean,"tipo"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categorias_financeiras_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categorias_financeiras_pai_fk"
      columns: ["empresa_id","pai_id"]
isOneToOne: false
      referencedRelation: "categorias_financeiras"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"centros_custo": {
                  Row: {
                    "ativo": boolean,"codigo": string | null,"created_at": string,"empresa_id": string,"id": string,"nome": string
                  }
                  Insert: {
                    "ativo"?: boolean,"codigo"?: string | null,"created_at"?: string,"empresa_id": string,"id"?: string,"nome": string
                  }
                  Update: {
                    "ativo"?: boolean,"codigo"?: string | null,"created_at"?: string,"empresa_id"?: string,"id"?: string,"nome"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "centros_custo_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_historico": {
                  Row: {
                    "acao": string,"alterado_em": string,"alterado_por": string | null,"empresa_id": string,"id": number,"item_id": string,"motivo": string | null,"status_anterior": string | null,"status_novo": string | null
                  }
                  Insert: {
                    "acao": string,"alterado_em"?: string,"alterado_por"?: string | null,"empresa_id": string,"id"?: never,"item_id": string,"motivo"?: string | null,"status_anterior"?: string | null,"status_novo"?: string | null
                  }
                  Update: {
                    "acao"?: string,"alterado_em"?: string,"alterado_por"?: string | null,"empresa_id"?: string,"id"?: never,"item_id"?: string,"motivo"?: string | null,"status_anterior"?: string | null,"status_novo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_historico_alterado_por_fkey"
      columns: ["alterado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_historico_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_historico_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "checklist_itens"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_itens": {
                  Row: {
                    "categoria_codigo": string,"chave_geracao": string | null,"competencia": string,"concluido_em": string | null,"concluido_por": string | null,"conclusao_manual": boolean,"conclusao_observacao": string | null,"conta_financeira_id": string | null,"correcao_motivo": string | null,"correcao_solicitada_em": string | null,"created_at": string,"criado_por": string | null,"descricao": string | null,"empresa_id": string,"id": string,"modelo_id": string | null,"nao_aplica_justificativa": string | null,"nao_aplica_resposta": string | null,"nao_aplica_revisado_em": string | null,"nao_aplica_revisado_por": string | null,"nao_aplica_solicitado_em": string | null,"nao_aplica_solicitado_por": string | null,"obrigatorio": boolean,"observacao_equipe": string | null,"prazo": string,"quantidade_minima": number,"responsavel_cliente_id": string | null,"responsavel_equipe_id": string | null,"status": string,"status_atualizado_em": string,"titulo": string,"updated_at": string
                  }
                  Insert: {
                    "categoria_codigo": string,"chave_geracao"?: string | null,"competencia": string,"concluido_em"?: string | null,"concluido_por"?: string | null,"conclusao_manual"?: boolean,"conclusao_observacao"?: string | null,"conta_financeira_id"?: string | null,"correcao_motivo"?: string | null,"correcao_solicitada_em"?: string | null,"created_at"?: string,"criado_por"?: string | null,"descricao"?: string | null,"empresa_id": string,"id"?: string,"modelo_id"?: string | null,"nao_aplica_justificativa"?: string | null,"nao_aplica_resposta"?: string | null,"nao_aplica_revisado_em"?: string | null,"nao_aplica_revisado_por"?: string | null,"nao_aplica_solicitado_em"?: string | null,"nao_aplica_solicitado_por"?: string | null,"obrigatorio"?: boolean,"observacao_equipe"?: string | null,"prazo": string,"quantidade_minima"?: number,"responsavel_cliente_id"?: string | null,"responsavel_equipe_id"?: string | null,"status"?: string,"status_atualizado_em"?: string,"titulo": string,"updated_at"?: string
                  }
                  Update: {
                    "categoria_codigo"?: string,"chave_geracao"?: string | null,"competencia"?: string,"concluido_em"?: string | null,"concluido_por"?: string | null,"conclusao_manual"?: boolean,"conclusao_observacao"?: string | null,"conta_financeira_id"?: string | null,"correcao_motivo"?: string | null,"correcao_solicitada_em"?: string | null,"created_at"?: string,"criado_por"?: string | null,"descricao"?: string | null,"empresa_id"?: string,"id"?: string,"modelo_id"?: string | null,"nao_aplica_justificativa"?: string | null,"nao_aplica_resposta"?: string | null,"nao_aplica_revisado_em"?: string | null,"nao_aplica_revisado_por"?: string | null,"nao_aplica_solicitado_em"?: string | null,"nao_aplica_solicitado_por"?: string | null,"obrigatorio"?: boolean,"observacao_equipe"?: string | null,"prazo"?: string,"quantidade_minima"?: number,"responsavel_cliente_id"?: string | null,"responsavel_equipe_id"?: string | null,"status"?: string,"status_atualizado_em"?: string,"titulo"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_itens_categoria_codigo_fkey"
      columns: ["categoria_codigo"]
isOneToOne: false
      referencedRelation: "categorias_documento"
      referencedColumns: ["codigo"]
    },{
      foreignKeyName: "checklist_itens_concluido_por_fkey"
      columns: ["concluido_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_conta_fk"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "checklist_itens_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_modelo_id_fkey"
      columns: ["modelo_id"]
isOneToOne: false
      referencedRelation: "checklist_modelos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_nao_aplica_revisado_por_fkey"
      columns: ["nao_aplica_revisado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_nao_aplica_solicitado_por_fkey"
      columns: ["nao_aplica_solicitado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_responsavel_cliente_id_fkey"
      columns: ["responsavel_cliente_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_itens_responsavel_equipe_id_fkey"
      columns: ["responsavel_equipe_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_modelos": {
                  Row: {
                    "ativo": boolean,"categoria_codigo": string,"codigo_padrao": string | null,"conta_financeira_id": string | null,"created_at": string,"descricao": string | null,"dia_prazo": number,"empresa_id": string,"id": string,"meses": (number)[] | null,"meses_apos": number,"obrigatorio": boolean,"ordem": number,"periodicidade": string,"por_conta": boolean,"quantidade_minima": number,"responsavel_cliente_id": string | null,"responsavel_equipe_id": string | null,"servico": string | null,"tipos_conta": (string)[] | null,"titulo": string,"updated_at": string
                  }
                  Insert: {
                    "ativo"?: boolean,"categoria_codigo": string,"codigo_padrao"?: string | null,"conta_financeira_id"?: string | null,"created_at"?: string,"descricao"?: string | null,"dia_prazo"?: number,"empresa_id": string,"id"?: string,"meses"?: (number)[] | null,"meses_apos"?: number,"obrigatorio"?: boolean,"ordem"?: number,"periodicidade"?: string,"por_conta"?: boolean,"quantidade_minima"?: number,"responsavel_cliente_id"?: string | null,"responsavel_equipe_id"?: string | null,"servico"?: string | null,"tipos_conta"?: (string)[] | null,"titulo": string,"updated_at"?: string
                  }
                  Update: {
                    "ativo"?: boolean,"categoria_codigo"?: string,"codigo_padrao"?: string | null,"conta_financeira_id"?: string | null,"created_at"?: string,"descricao"?: string | null,"dia_prazo"?: number,"empresa_id"?: string,"id"?: string,"meses"?: (number)[] | null,"meses_apos"?: number,"obrigatorio"?: boolean,"ordem"?: number,"periodicidade"?: string,"por_conta"?: boolean,"quantidade_minima"?: number,"responsavel_cliente_id"?: string | null,"responsavel_equipe_id"?: string | null,"servico"?: string | null,"tipos_conta"?: (string)[] | null,"titulo"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_modelos_categoria_codigo_fkey"
      columns: ["categoria_codigo"]
isOneToOne: false
      referencedRelation: "categorias_documento"
      referencedColumns: ["codigo"]
    },{
      foreignKeyName: "checklist_modelos_conta_fk"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "checklist_modelos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_modelos_responsavel_cliente_id_fkey"
      columns: ["responsavel_cliente_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_modelos_responsavel_equipe_id_fkey"
      columns: ["responsavel_equipe_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"competencia_historico": {
                  Row: {
                    "acao": string,"competencia_id": string,"detalhes": Json | null,"em": string,"empresa_id": string,"etapa": string | null,"id": number,"por": string | null
                  }
                  Insert: {
                    "acao": string,"competencia_id": string,"detalhes"?: Json | null,"em"?: string,"empresa_id": string,"etapa"?: string | null,"id"?: never,"por"?: string | null
                  }
                  Update: {
                    "acao"?: string,"competencia_id"?: string,"detalhes"?: Json | null,"em"?: string,"empresa_id"?: string,"etapa"?: string | null,"id"?: never,"por"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "competencia_historico_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competencia_historico_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competencia_historico_por_fkey"
      columns: ["por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"competencias": {
                  Row: {
                    "competencia": string,"created_at": string,"empresa_id": string,"fechada_em": string | null,"fechada_por": string | null,"id": string,"observacoes": string | null,"reaberta_em": string | null,"reaberta_por": string | null,"reabertura_justificativa": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "competencia": string,"created_at"?: string,"empresa_id": string,"fechada_em"?: string | null,"fechada_por"?: string | null,"id"?: string,"observacoes"?: string | null,"reaberta_em"?: string | null,"reaberta_por"?: string | null,"reabertura_justificativa"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "competencia"?: string,"created_at"?: string,"empresa_id"?: string,"fechada_em"?: string | null,"fechada_por"?: string | null,"id"?: string,"observacoes"?: string | null,"reaberta_em"?: string | null,"reaberta_por"?: string | null,"reabertura_justificativa"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competencias_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competencias_fechada_por_fkey"
      columns: ["fechada_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competencias_reaberta_por_fkey"
      columns: ["reaberta_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"conciliacao_itens": {
                  Row: {
                    "ativo": boolean,"baixa_id": string | null,"conciliacao_id": string,"empresa_id": string,"id": string,"lancamento_id": string | null,"movimento_id": string | null,"transferencia_id": string | null,"valor": number
                  }
                  Insert: {
                    "ativo"?: boolean,"baixa_id"?: string | null,"conciliacao_id": string,"empresa_id": string,"id"?: string,"lancamento_id"?: string | null,"movimento_id"?: string | null,"transferencia_id"?: string | null,"valor": number
                  }
                  Update: {
                    "ativo"?: boolean,"baixa_id"?: string | null,"conciliacao_id"?: string,"empresa_id"?: string,"id"?: string,"lancamento_id"?: string | null,"movimento_id"?: string | null,"transferencia_id"?: string | null,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "conciliacao_itens_empresa_id_baixa_id_fkey"
      columns: ["empresa_id","baixa_id"]
isOneToOne: false
      referencedRelation: "baixas"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "conciliacao_itens_empresa_id_conciliacao_id_fkey"
      columns: ["empresa_id","conciliacao_id"]
isOneToOne: false
      referencedRelation: "conciliacoes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "conciliacao_itens_empresa_id_lancamento_id_fkey"
      columns: ["empresa_id","lancamento_id"]
isOneToOne: false
      referencedRelation: "lancamentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "conciliacao_itens_empresa_id_movimento_id_fkey"
      columns: ["empresa_id","movimento_id"]
isOneToOne: false
      referencedRelation: "movimentos_bancarios"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "conciliacao_itens_empresa_id_transferencia_id_fkey"
      columns: ["empresa_id","transferencia_id"]
isOneToOne: false
      referencedRelation: "transferencias"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"conciliacao_rejeicoes": {
                  Row: {
                    "alvo_id": string,"empresa_id": string,"movimento_id": string,"rejeitada_em": string,"rejeitada_por": string | null
                  }
                  Insert: {
                    "alvo_id": string,"empresa_id": string,"movimento_id": string,"rejeitada_em"?: string,"rejeitada_por"?: string | null
                  }
                  Update: {
                    "alvo_id"?: string,"empresa_id"?: string,"movimento_id"?: string,"rejeitada_em"?: string,"rejeitada_por"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conciliacao_rejeicoes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conciliacao_rejeicoes_rejeitada_por_fkey"
      columns: ["rejeitada_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"conciliacoes": {
                  Row: {
                    "confirmada_em": string | null,"confirmada_por": string | null,"conta_financeira_id": string | null,"created_at": string,"criado_por": string | null,"criterios": NonNullable<Json>,"desfeita_em": string | null,"desfeita_por": string | null,"diferenca": number,"empresa_id": string,"id": string,"lancamentos_criados": (string)[],"motivo_desfazer": string | null,"motivo_rejeicao": string | null,"observacao": string | null,"origem": string,"pontuacao": number | null,"rejeitada_em": string | null,"rejeitada_por": string | null,"status": string,"tipo": string,"tratamento_diferenca": string | null
                  }
                  Insert: {
                    "confirmada_em"?: string | null,"confirmada_por"?: string | null,"conta_financeira_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"criterios"?: NonNullable<Json>,"desfeita_em"?: string | null,"desfeita_por"?: string | null,"diferenca"?: number,"empresa_id": string,"id"?: string,"lancamentos_criados"?: (string)[],"motivo_desfazer"?: string | null,"motivo_rejeicao"?: string | null,"observacao"?: string | null,"origem"?: string,"pontuacao"?: number | null,"rejeitada_em"?: string | null,"rejeitada_por"?: string | null,"status"?: string,"tipo"?: string,"tratamento_diferenca"?: string | null
                  }
                  Update: {
                    "confirmada_em"?: string | null,"confirmada_por"?: string | null,"conta_financeira_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"criterios"?: NonNullable<Json>,"desfeita_em"?: string | null,"desfeita_por"?: string | null,"diferenca"?: number,"empresa_id"?: string,"id"?: string,"lancamentos_criados"?: (string)[],"motivo_desfazer"?: string | null,"motivo_rejeicao"?: string | null,"observacao"?: string | null,"origem"?: string,"pontuacao"?: number | null,"rejeitada_em"?: string | null,"rejeitada_por"?: string | null,"status"?: string,"tipo"?: string,"tratamento_diferenca"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conciliacoes_confirmada_por_fkey"
      columns: ["confirmada_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conciliacoes_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conciliacoes_desfeita_por_fkey"
      columns: ["desfeita_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conciliacoes_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "conciliacoes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conciliacoes_rejeitada_por_fkey"
      columns: ["rejeitada_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"contas_financeiras": {
                  Row: {
                    "agencia": string | null,"ativa": boolean,"banco_codigo": string | null,"banco_nome": string | null,"cartao_conta_pagamento_id": string | null,"cartao_dia_fechamento": number | null,"cartao_dia_vencimento": number | null,"compoe_saldo_disponivel": boolean,"created_at": string,"empresa_id": string,"id": string,"limite": number | null,"nome": string,"numero": string | null,"observacoes": string | null,"saldo_inicial": number,"saldo_inicial_data": string,"tipo": string,"updated_at": string
                  }
                  Insert: {
                    "agencia"?: string | null,"ativa"?: boolean,"banco_codigo"?: string | null,"banco_nome"?: string | null,"cartao_conta_pagamento_id"?: string | null,"cartao_dia_fechamento"?: number | null,"cartao_dia_vencimento"?: number | null,"compoe_saldo_disponivel"?: boolean,"created_at"?: string,"empresa_id": string,"id"?: string,"limite"?: number | null,"nome": string,"numero"?: string | null,"observacoes"?: string | null,"saldo_inicial"?: number,"saldo_inicial_data": string,"tipo": string,"updated_at"?: string
                  }
                  Update: {
                    "agencia"?: string | null,"ativa"?: boolean,"banco_codigo"?: string | null,"banco_nome"?: string | null,"cartao_conta_pagamento_id"?: string | null,"cartao_dia_fechamento"?: number | null,"cartao_dia_vencimento"?: number | null,"compoe_saldo_disponivel"?: boolean,"created_at"?: string,"empresa_id"?: string,"id"?: string,"limite"?: number | null,"nome"?: string,"numero"?: string | null,"observacoes"?: string | null,"saldo_inicial"?: number,"saldo_inicial_data"?: string,"tipo"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contas_financeiras_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contas_financeiras_pagamento_fk"
      columns: ["empresa_id","cartao_conta_pagamento_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"contrapartes": {
                  Row: {
                    "ativo": boolean,"created_at": string,"documento": string | null,"email": string | null,"empresa_id": string,"id": string,"nome": string,"observacoes": string | null,"papeis": (string)[],"telefone": string | null,"tipo_pessoa": string | null,"updated_at": string
                  }
                  Insert: {
                    "ativo"?: boolean,"created_at"?: string,"documento"?: string | null,"email"?: string | null,"empresa_id": string,"id"?: string,"nome": string,"observacoes"?: string | null,"papeis"?: (string)[],"telefone"?: string | null,"tipo_pessoa"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "ativo"?: boolean,"created_at"?: string,"documento"?: string | null,"email"?: string | null,"empresa_id"?: string,"id"?: string,"nome"?: string,"observacoes"?: string | null,"papeis"?: (string)[],"telefone"?: string | null,"tipo_pessoa"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contrapartes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"conversa_leituras": {
                  Row: {
                    "conversa_id": string,"lida_em": string,"user_id": string
                  }
                  Insert: {
                    "conversa_id": string,"lida_em"?: string,"user_id": string
                  }
                  Update: {
                    "conversa_id"?: string,"lida_em"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversa_leituras_conversa_id_fkey"
      columns: ["conversa_id"]
isOneToOne: false
      referencedRelation: "conversas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversa_leituras_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"conversas": {
                  Row: {
                    "aguardando": string | null,"assunto": string,"checklist_item_id": string | null,"competencia": string | null,"created_at": string,"criado_por": string | null,"documento_id": string | null,"empresa_id": string,"id": string,"status": string,"tipo": string,"ultima_mensagem_em": string,"updated_at": string
                  }
                  Insert: {
                    "aguardando"?: string | null,"assunto": string,"checklist_item_id"?: string | null,"competencia"?: string | null,"created_at"?: string,"criado_por"?: string | null,"documento_id"?: string | null,"empresa_id": string,"id"?: string,"status"?: string,"tipo"?: string,"ultima_mensagem_em"?: string,"updated_at"?: string
                  }
                  Update: {
                    "aguardando"?: string | null,"assunto"?: string,"checklist_item_id"?: string | null,"competencia"?: string | null,"created_at"?: string,"criado_por"?: string | null,"documento_id"?: string | null,"empresa_id"?: string,"id"?: string,"status"?: string,"tipo"?: string,"ultima_mensagem_em"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversas_checklist_item_id_fkey"
      columns: ["checklist_item_id"]
isOneToOne: false
      referencedRelation: "checklist_itens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversas_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversas_documento_id_fkey"
      columns: ["documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversas_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"convites": {
                  Row: {
                    "aceito_em": string | null,"convidado_por": string | null,"created_at": string,"email": string,"empresa_id": string | null,"envio_erro": string | null,"envio_status": string,"id": string,"nome": string | null,"papel": string | null,"permissoes": (string)[],"status": string,"tipo_usuario": string,"ultimo_envio_em": string | null,"user_id": string | null
                  }
                  Insert: {
                    "aceito_em"?: string | null,"convidado_por"?: string | null,"created_at"?: string,"email": string,"empresa_id"?: string | null,"envio_erro"?: string | null,"envio_status"?: string,"id"?: string,"nome"?: string | null,"papel"?: string | null,"permissoes"?: (string)[],"status"?: string,"tipo_usuario": string,"ultimo_envio_em"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "aceito_em"?: string | null,"convidado_por"?: string | null,"created_at"?: string,"email"?: string,"empresa_id"?: string | null,"envio_erro"?: string | null,"envio_status"?: string,"id"?: string,"nome"?: string | null,"papel"?: string | null,"permissoes"?: (string)[],"status"?: string,"tipo_usuario"?: string,"ultimo_envio_em"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "convites_convidado_por_fkey"
      columns: ["convidado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "convites_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "convites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"documento_acessos": {
                  Row: {
                    "documento_id": string,"empresa_id": string,"id": number,"ip": string | null,"ocorrido_em": string,"tipo": string,"user_agent": string | null,"user_id": string | null,"versao": number | null
                  }
                  Insert: {
                    "documento_id": string,"empresa_id": string,"id"?: never,"ip"?: string | null,"ocorrido_em"?: string,"tipo": string,"user_agent"?: string | null,"user_id"?: string | null,"versao"?: number | null
                  }
                  Update: {
                    "documento_id"?: string,"empresa_id"?: string,"id"?: never,"ip"?: string | null,"ocorrido_em"?: string,"tipo"?: string,"user_agent"?: string | null,"user_id"?: string | null,"versao"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documento_acessos_documento_id_fkey"
      columns: ["documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_acessos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_acessos_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"documento_fiscal_eventos": {
                  Row: {
                    "chave_acesso": string,"correcao": string | null,"created_at": string,"cstat": string | null,"data_evento": string | null,"descricao_evento": string | null,"documento_id": string,"empresa_id": string,"id": string,"identificador": string,"justificativa": string | null,"modelo": string | null,"protocolo": string | null,"sequencia": number | null,"tipo_evento": string
                  }
                  Insert: {
                    "chave_acesso": string,"correcao"?: string | null,"created_at"?: string,"cstat"?: string | null,"data_evento"?: string | null,"descricao_evento"?: string | null,"documento_id": string,"empresa_id": string,"id"?: string,"identificador": string,"justificativa"?: string | null,"modelo"?: string | null,"protocolo"?: string | null,"sequencia"?: number | null,"tipo_evento": string
                  }
                  Update: {
                    "chave_acesso"?: string,"correcao"?: string | null,"created_at"?: string,"cstat"?: string | null,"data_evento"?: string | null,"descricao_evento"?: string | null,"documento_id"?: string,"empresa_id"?: string,"id"?: string,"identificador"?: string,"justificativa"?: string | null,"modelo"?: string | null,"protocolo"?: string | null,"sequencia"?: number | null,"tipo_evento"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documento_fiscal_eventos_empresa_id_documento_id_fkey"
      columns: ["empresa_id","documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "documento_fiscal_eventos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"documento_fiscal_itens": {
                  Row: {
                    "cfop": string | null,"codigo": string | null,"descricao": string | null,"documento_fiscal_id": string,"empresa_id": string,"id": string,"ncm": string | null,"numero_item": number,"quantidade": number | null,"tributos": NonNullable<Json>,"unidade": string | null,"valor_desconto": number | null,"valor_total": number | null,"valor_unitario": number | null
                  }
                  Insert: {
                    "cfop"?: string | null,"codigo"?: string | null,"descricao"?: string | null,"documento_fiscal_id": string,"empresa_id": string,"id"?: string,"ncm"?: string | null,"numero_item": number,"quantidade"?: number | null,"tributos"?: NonNullable<Json>,"unidade"?: string | null,"valor_desconto"?: number | null,"valor_total"?: number | null,"valor_unitario"?: number | null
                  }
                  Update: {
                    "cfop"?: string | null,"codigo"?: string | null,"descricao"?: string | null,"documento_fiscal_id"?: string,"empresa_id"?: string,"id"?: string,"ncm"?: string | null,"numero_item"?: number,"quantidade"?: number | null,"tributos"?: NonNullable<Json>,"unidade"?: string | null,"valor_desconto"?: number | null,"valor_total"?: number | null,"valor_unitario"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documento_fiscal_itens_empresa_id_documento_fiscal_id_fkey"
      columns: ["empresa_id","documento_fiscal_id"]
isOneToOne: false
      referencedRelation: "documentos_fiscais"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"documento_historico": {
                  Row: {
                    "acao": string,"alterado_em": string,"alterado_por": string | null,"detalhes": Json | null,"documento_id": string,"empresa_id": string,"id": number,"motivo": string | null,"status_anterior": string | null,"status_novo": string | null
                  }
                  Insert: {
                    "acao": string,"alterado_em"?: string,"alterado_por"?: string | null,"detalhes"?: Json | null,"documento_id": string,"empresa_id": string,"id"?: never,"motivo"?: string | null,"status_anterior"?: string | null,"status_novo"?: string | null
                  }
                  Update: {
                    "acao"?: string,"alterado_em"?: string,"alterado_por"?: string | null,"detalhes"?: Json | null,"documento_id"?: string,"empresa_id"?: string,"id"?: never,"motivo"?: string | null,"status_anterior"?: string | null,"status_novo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documento_historico_alterado_por_fkey"
      columns: ["alterado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_historico_documento_id_fkey"
      columns: ["documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_historico_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"documento_versoes": {
                  Row: {
                    "criado_em": string,"documento_id": string,"empresa_id": string,"enviado_por": string | null,"id": string,"mime": string | null,"motivo": string | null,"nome_original": string,"sha256": string | null,"storage_path": string,"tamanho": number | null,"upload_concluido_em": string | null,"verificacao_detalhes": string | null,"verificacao_status": string,"versao": number
                  }
                  Insert: {
                    "criado_em"?: string,"documento_id": string,"empresa_id": string,"enviado_por"?: string | null,"id"?: string,"mime"?: string | null,"motivo"?: string | null,"nome_original": string,"sha256"?: string | null,"storage_path": string,"tamanho"?: number | null,"upload_concluido_em"?: string | null,"verificacao_detalhes"?: string | null,"verificacao_status"?: string,"versao": number
                  }
                  Update: {
                    "criado_em"?: string,"documento_id"?: string,"empresa_id"?: string,"enviado_por"?: string | null,"id"?: string,"mime"?: string | null,"motivo"?: string | null,"nome_original"?: string,"sha256"?: string | null,"storage_path"?: string,"tamanho"?: number | null,"upload_concluido_em"?: string | null,"verificacao_detalhes"?: string | null,"verificacao_status"?: string,"versao"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "documento_versoes_documento_id_fkey"
      columns: ["documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_versoes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documento_versoes_enviado_por_fkey"
      columns: ["enviado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"documentos": {
                  Row: {
                    "apos_fechamento_avaliado_em": string | null,"apos_fechamento_avaliado_por": string | null,"apos_fechamento_parecer": string | null,"categoria_codigo": string,"checklist_item_id": string | null,"competencia": string,"created_at": string,"direcao": string,"duplicado_de": string | null,"empresa_id": string,"enviado_em": string | null,"enviado_por": string | null,"excluido_em": string | null,"excluido_por": string | null,"expurgado_em": string | null,"expurgado_por": string | null,"expurgo_motivo": string | null,"extensao": string | null,"extracao": Json | null,"id": string,"mime": string | null,"motivo_exclusao": string | null,"nome_original": string,"observacao": string | null,"origem": string,"processamento_detalhes": Json | null,"processamento_status": string,"publicado_em": string | null,"recebido_apos_fechamento": boolean,"requer_conferencia": boolean,"sha256": string | null,"status": string | null,"status_alterado_em": string | null,"status_alterado_por": string | null,"status_motivo": string | null,"storage_path": string | null,"sugestao": Json | null,"tamanho": number | null,"titulo": string | null,"updated_at": string,"upload_status": string,"valor": number | null,"vencimento": string | null,"verificacao_detalhes": string | null,"verificacao_status": string,"versao_atual": number,"zip_caminho": string | null,"zip_origem_id": string | null
                  }
                  Insert: {
                    "apos_fechamento_avaliado_em"?: string | null,"apos_fechamento_avaliado_por"?: string | null,"apos_fechamento_parecer"?: string | null,"categoria_codigo": string,"checklist_item_id"?: string | null,"competencia": string,"created_at"?: string,"direcao"?: string,"duplicado_de"?: string | null,"empresa_id": string,"enviado_em"?: string | null,"enviado_por"?: string | null,"excluido_em"?: string | null,"excluido_por"?: string | null,"expurgado_em"?: string | null,"expurgado_por"?: string | null,"expurgo_motivo"?: string | null,"extensao"?: string | null,"extracao"?: Json | null,"id"?: string,"mime"?: string | null,"motivo_exclusao"?: string | null,"nome_original": string,"observacao"?: string | null,"origem"?: string,"processamento_detalhes"?: Json | null,"processamento_status"?: string,"publicado_em"?: string | null,"recebido_apos_fechamento"?: boolean,"requer_conferencia"?: boolean,"sha256"?: string | null,"status"?: string | null,"status_alterado_em"?: string | null,"status_alterado_por"?: string | null,"status_motivo"?: string | null,"storage_path"?: string | null,"sugestao"?: Json | null,"tamanho"?: number | null,"titulo"?: string | null,"updated_at"?: string,"upload_status"?: string,"valor"?: number | null,"vencimento"?: string | null,"verificacao_detalhes"?: string | null,"verificacao_status"?: string,"versao_atual"?: number,"zip_caminho"?: string | null,"zip_origem_id"?: string | null
                  }
                  Update: {
                    "apos_fechamento_avaliado_em"?: string | null,"apos_fechamento_avaliado_por"?: string | null,"apos_fechamento_parecer"?: string | null,"categoria_codigo"?: string,"checklist_item_id"?: string | null,"competencia"?: string,"created_at"?: string,"direcao"?: string,"duplicado_de"?: string | null,"empresa_id"?: string,"enviado_em"?: string | null,"enviado_por"?: string | null,"excluido_em"?: string | null,"excluido_por"?: string | null,"expurgado_em"?: string | null,"expurgado_por"?: string | null,"expurgo_motivo"?: string | null,"extensao"?: string | null,"extracao"?: Json | null,"id"?: string,"mime"?: string | null,"motivo_exclusao"?: string | null,"nome_original"?: string,"observacao"?: string | null,"origem"?: string,"processamento_detalhes"?: Json | null,"processamento_status"?: string,"publicado_em"?: string | null,"recebido_apos_fechamento"?: boolean,"requer_conferencia"?: boolean,"sha256"?: string | null,"status"?: string | null,"status_alterado_em"?: string | null,"status_alterado_por"?: string | null,"status_motivo"?: string | null,"storage_path"?: string | null,"sugestao"?: Json | null,"tamanho"?: number | null,"titulo"?: string | null,"updated_at"?: string,"upload_status"?: string,"valor"?: number | null,"vencimento"?: string | null,"verificacao_detalhes"?: string | null,"verificacao_status"?: string,"versao_atual"?: number,"zip_caminho"?: string | null,"zip_origem_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documentos_apos_fechamento_avaliado_por_fkey"
      columns: ["apos_fechamento_avaliado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_categoria_codigo_fkey"
      columns: ["categoria_codigo"]
isOneToOne: false
      referencedRelation: "categorias_documento"
      referencedColumns: ["codigo"]
    },{
      foreignKeyName: "documentos_checklist_item_fk"
      columns: ["checklist_item_id"]
isOneToOne: false
      referencedRelation: "checklist_itens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_duplicado_de_fkey"
      columns: ["duplicado_de"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_enviado_por_fkey"
      columns: ["enviado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_excluido_por_fkey"
      columns: ["excluido_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_expurgado_por_fkey"
      columns: ["expurgado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_status_alterado_por_fkey"
      columns: ["status_alterado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documentos_zip_origem_id_fkey"
      columns: ["zip_origem_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["id"]
    }
                  ]
                },"documentos_fiscais": {
                  Row: {
                    "avisos": NonNullable<Json>,"cancelada_evento": boolean,"cfops": (string)[],"chave_acesso": string | null,"competencia": string,"created_at": string,"data_emissao": string | null,"destinatario_documento": string | null,"destinatario_nome": string | null,"destinatario_uf": string | null,"documento_id": string,"duplicatas": NonNullable<Json>,"emitente_documento": string | null,"emitente_ie": string | null,"emitente_nome": string | null,"emitente_uf": string | null,"empresa_id": string,"finalidade": string | null,"id": string,"identificador": string,"modelo": string,"natureza_operacao": string | null,"numero": string | null,"operacao": string,"pagamentos": NonNullable<Json>,"protocolo": Json | null,"relacionado_empresa": boolean,"serie": string | null,"situacao_arquivo": string,"tipo_documento": string,"tp_nf": string | null,"tributos": NonNullable<Json>,"updated_at": string,"valor_desconto": number | null,"valor_frete": number | null,"valor_outros": number | null,"valor_produtos": number | null,"valor_servicos": number | null,"valor_total": number | null
                  }
                  Insert: {
                    "avisos"?: NonNullable<Json>,"cancelada_evento"?: boolean,"cfops"?: (string)[],"chave_acesso"?: string | null,"competencia": string,"created_at"?: string,"data_emissao"?: string | null,"destinatario_documento"?: string | null,"destinatario_nome"?: string | null,"destinatario_uf"?: string | null,"documento_id": string,"duplicatas"?: NonNullable<Json>,"emitente_documento"?: string | null,"emitente_ie"?: string | null,"emitente_nome"?: string | null,"emitente_uf"?: string | null,"empresa_id": string,"finalidade"?: string | null,"id"?: string,"identificador": string,"modelo": string,"natureza_operacao"?: string | null,"numero"?: string | null,"operacao": string,"pagamentos"?: NonNullable<Json>,"protocolo"?: Json | null,"relacionado_empresa"?: boolean,"serie"?: string | null,"situacao_arquivo": string,"tipo_documento": string,"tp_nf"?: string | null,"tributos"?: NonNullable<Json>,"updated_at"?: string,"valor_desconto"?: number | null,"valor_frete"?: number | null,"valor_outros"?: number | null,"valor_produtos"?: number | null,"valor_servicos"?: number | null,"valor_total"?: number | null
                  }
                  Update: {
                    "avisos"?: NonNullable<Json>,"cancelada_evento"?: boolean,"cfops"?: (string)[],"chave_acesso"?: string | null,"competencia"?: string,"created_at"?: string,"data_emissao"?: string | null,"destinatario_documento"?: string | null,"destinatario_nome"?: string | null,"destinatario_uf"?: string | null,"documento_id"?: string,"duplicatas"?: NonNullable<Json>,"emitente_documento"?: string | null,"emitente_ie"?: string | null,"emitente_nome"?: string | null,"emitente_uf"?: string | null,"empresa_id"?: string,"finalidade"?: string | null,"id"?: string,"identificador"?: string,"modelo"?: string,"natureza_operacao"?: string | null,"numero"?: string | null,"operacao"?: string,"pagamentos"?: NonNullable<Json>,"protocolo"?: Json | null,"relacionado_empresa"?: boolean,"serie"?: string | null,"situacao_arquivo"?: string,"tipo_documento"?: string,"tp_nf"?: string | null,"tributos"?: NonNullable<Json>,"updated_at"?: string,"valor_desconto"?: number | null,"valor_frete"?: number | null,"valor_outros"?: number | null,"valor_produtos"?: number | null,"valor_servicos"?: number | null,"valor_total"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documentos_fiscais_empresa_id_documento_id_fkey"
      columns: ["empresa_id","documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "documentos_fiscais_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"empresa_contatos": {
                  Row: {
                    "created_at": string,"email": string | null,"empresa_id": string,"funcao": string,"id": string,"nome": string,"observacoes": string | null,"principal": boolean,"recebe_lembretes": boolean,"telefone": string | null,"updated_at": string,"whatsapp": string | null
                  }
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"empresa_id": string,"funcao"?: string,"id"?: string,"nome": string,"observacoes"?: string | null,"principal"?: boolean,"recebe_lembretes"?: boolean,"telefone"?: string | null,"updated_at"?: string,"whatsapp"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"empresa_id"?: string,"funcao"?: string,"id"?: string,"nome"?: string,"observacoes"?: string | null,"principal"?: boolean,"recebe_lembretes"?: boolean,"telefone"?: string | null,"updated_at"?: string,"whatsapp"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "empresa_contatos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"empresa_membros": {
                  Row: {
                    "ativo": boolean,"convidado_em": string,"convidado_por": string | null,"created_at": string,"empresa_id": string,"id": string,"motivo_revogacao": string | null,"papel": string,"permissoes": (string)[],"revogado_em": string | null,"revogado_por": string | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "ativo"?: boolean,"convidado_em"?: string,"convidado_por"?: string | null,"created_at"?: string,"empresa_id": string,"id"?: string,"motivo_revogacao"?: string | null,"papel": string,"permissoes"?: (string)[],"revogado_em"?: string | null,"revogado_por"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "ativo"?: boolean,"convidado_em"?: string,"convidado_por"?: string | null,"created_at"?: string,"empresa_id"?: string,"id"?: string,"motivo_revogacao"?: string | null,"papel"?: string,"permissoes"?: (string)[],"revogado_em"?: string | null,"revogado_por"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "empresa_membros_convidado_por_fkey"
      columns: ["convidado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empresa_membros_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empresa_membros_revogado_por_fkey"
      columns: ["revogado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empresa_membros_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"empresas": {
                  Row: {
                    "ativa": boolean,"atividade_principal": string | null,"bairro": string | null,"cep": string | null,"cidade": string | null,"cnae": string | null,"complemento": string | null,"contador_responsavel_id": string | null,"controla_estoque": boolean,"created_at": string,"criado_por": string | null,"data_inicio_atendimento": string | null,"demonstracao": boolean,"documento": string,"email": string | null,"id": string,"inscricao_estadual": string | null,"inscricao_municipal": string | null,"logradouro": string | null,"nome_fantasia": string | null,"numero": string | null,"observacoes": string | null,"razao_social": string,"regime_tributario": string,"servicos": (string)[],"sugerir_lancamentos_xml": boolean,"telefone": string | null,"tipo_pessoa": string,"uf": string | null,"updated_at": string
                  }
                  Insert: {
                    "ativa"?: boolean,"atividade_principal"?: string | null,"bairro"?: string | null,"cep"?: string | null,"cidade"?: string | null,"cnae"?: string | null,"complemento"?: string | null,"contador_responsavel_id"?: string | null,"controla_estoque"?: boolean,"created_at"?: string,"criado_por"?: string | null,"data_inicio_atendimento"?: string | null,"demonstracao"?: boolean,"documento": string,"email"?: string | null,"id"?: string,"inscricao_estadual"?: string | null,"inscricao_municipal"?: string | null,"logradouro"?: string | null,"nome_fantasia"?: string | null,"numero"?: string | null,"observacoes"?: string | null,"razao_social": string,"regime_tributario": string,"servicos"?: (string)[],"sugerir_lancamentos_xml"?: boolean,"telefone"?: string | null,"tipo_pessoa"?: string,"uf"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "ativa"?: boolean,"atividade_principal"?: string | null,"bairro"?: string | null,"cep"?: string | null,"cidade"?: string | null,"cnae"?: string | null,"complemento"?: string | null,"contador_responsavel_id"?: string | null,"controla_estoque"?: boolean,"created_at"?: string,"criado_por"?: string | null,"data_inicio_atendimento"?: string | null,"demonstracao"?: boolean,"documento"?: string,"email"?: string | null,"id"?: string,"inscricao_estadual"?: string | null,"inscricao_municipal"?: string | null,"logradouro"?: string | null,"nome_fantasia"?: string | null,"numero"?: string | null,"observacoes"?: string | null,"razao_social"?: string,"regime_tributario"?: string,"servicos"?: (string)[],"sugerir_lancamentos_xml"?: boolean,"telefone"?: string | null,"tipo_pessoa"?: string,"uf"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "empresas_contador_responsavel_id_fkey"
      columns: ["contador_responsavel_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empresas_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"envios": {
                  Row: {
                    "assunto": string | null,"canal": string,"conteudo": string | null,"created_at": string,"destinatario": string,"empresa_id": string | null,"enviado_em": string | null,"erro": string | null,"id": string,"provedor_id": string | null,"referencia_id": string | null,"referencia_tipo": string | null,"solicitado_por": string | null,"status": string,"tentativas": number,"tipo": string,"user_id": string | null
                  }
                  Insert: {
                    "assunto"?: string | null,"canal": string,"conteudo"?: string | null,"created_at"?: string,"destinatario": string,"empresa_id"?: string | null,"enviado_em"?: string | null,"erro"?: string | null,"id"?: string,"provedor_id"?: string | null,"referencia_id"?: string | null,"referencia_tipo"?: string | null,"solicitado_por"?: string | null,"status"?: string,"tentativas"?: number,"tipo"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "assunto"?: string | null,"canal"?: string,"conteudo"?: string | null,"created_at"?: string,"destinatario"?: string,"empresa_id"?: string | null,"enviado_em"?: string | null,"erro"?: string | null,"id"?: string,"provedor_id"?: string | null,"referencia_id"?: string | null,"referencia_tipo"?: string | null,"solicitado_por"?: string | null,"status"?: string,"tentativas"?: number,"tipo"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "envios_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "envios_solicitado_por_fkey"
      columns: ["solicitado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "envios_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"escritorio": {
                  Row: {
                    "bairro": string | null,"cep": string | null,"cidade": string | null,"cnpj": string,"complemento": string | null,"descricao_sistema": string,"email": string | null,"exigir_2fa_clientes": boolean,"exigir_2fa_equipe": boolean,"id": number,"instagram": string | null,"lembretes_dias": (number)[],"lembretes_email_ativo": boolean,"lembretes_whatsapp_ativo": boolean,"logo_atualizado_em": string | null,"logo_path": string | null,"logradouro": string | null,"mensagem_login": string,"nome_fantasia": string,"nome_sistema": string,"numero": string | null,"razao_social": string,"retencao_padrao_anos": number,"site": string | null,"telefone": string | null,"uf": string | null,"updated_at": string,"updated_by": string | null,"upload_tamanho_maximo_mb": number,"whatsapp": string | null,"whatsapp_phone_number_id": string | null,"whatsapp_template_idioma": string,"whatsapp_template_lembrete": string | null,"zip_max_arquivos": number,"zip_max_tamanho_mb": number
                  }
                  Insert: {
                    "bairro"?: string | null,"cep"?: string | null,"cidade"?: string | null,"cnpj": string,"complemento"?: string | null,"descricao_sistema"?: string,"email"?: string | null,"exigir_2fa_clientes"?: boolean,"exigir_2fa_equipe"?: boolean,"id"?: number,"instagram"?: string | null,"lembretes_dias"?: (number)[],"lembretes_email_ativo"?: boolean,"lembretes_whatsapp_ativo"?: boolean,"logo_atualizado_em"?: string | null,"logo_path"?: string | null,"logradouro"?: string | null,"mensagem_login"?: string,"nome_fantasia": string,"nome_sistema"?: string,"numero"?: string | null,"razao_social": string,"retencao_padrao_anos"?: number,"site"?: string | null,"telefone"?: string | null,"uf"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"upload_tamanho_maximo_mb"?: number,"whatsapp"?: string | null,"whatsapp_phone_number_id"?: string | null,"whatsapp_template_idioma"?: string,"whatsapp_template_lembrete"?: string | null,"zip_max_arquivos"?: number,"zip_max_tamanho_mb"?: number
                  }
                  Update: {
                    "bairro"?: string | null,"cep"?: string | null,"cidade"?: string | null,"cnpj"?: string,"complemento"?: string | null,"descricao_sistema"?: string,"email"?: string | null,"exigir_2fa_clientes"?: boolean,"exigir_2fa_equipe"?: boolean,"id"?: number,"instagram"?: string | null,"lembretes_dias"?: (number)[],"lembretes_email_ativo"?: boolean,"lembretes_whatsapp_ativo"?: boolean,"logo_atualizado_em"?: string | null,"logo_path"?: string | null,"logradouro"?: string | null,"mensagem_login"?: string,"nome_fantasia"?: string,"nome_sistema"?: string,"numero"?: string | null,"razao_social"?: string,"retencao_padrao_anos"?: number,"site"?: string | null,"telefone"?: string | null,"uf"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"upload_tamanho_maximo_mb"?: number,"whatsapp"?: string | null,"whatsapp_phone_number_id"?: string | null,"whatsapp_template_idioma"?: string,"whatsapp_template_lembrete"?: string | null,"zip_max_arquivos"?: number,"zip_max_tamanho_mb"?: number
                  }
                  Relationships: [
                    
                  ]
                },"estoques": {
                  Row: {
                    "competencia": string,"created_at": string,"documento_id": string | null,"empresa_id": string,"fonte": string | null,"id": string,"informado_por": string | null,"observacao": string | null,"valor_estoque_final": number
                  }
                  Insert: {
                    "competencia": string,"created_at"?: string,"documento_id"?: string | null,"empresa_id": string,"fonte"?: string | null,"id"?: string,"informado_por"?: string | null,"observacao"?: string | null,"valor_estoque_final": number
                  }
                  Update: {
                    "competencia"?: string,"created_at"?: string,"documento_id"?: string | null,"empresa_id"?: string,"fonte"?: string | null,"id"?: string,"informado_por"?: string | null,"observacao"?: string | null,"valor_estoque_final"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "estoques_empresa_id_documento_id_fkey"
      columns: ["empresa_id","documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "estoques_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "estoques_informado_por_fkey"
      columns: ["informado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"extrato_saldos": {
                  Row: {
                    "conta_financeira_id": string,"created_at": string,"data": string,"empresa_id": string,"fonte": string,"id": string,"importacao_id": string | null,"informado_por": string | null,"saldo": number
                  }
                  Insert: {
                    "conta_financeira_id": string,"created_at"?: string,"data": string,"empresa_id": string,"fonte"?: string,"id"?: string,"importacao_id"?: string | null,"informado_por"?: string | null,"saldo": number
                  }
                  Update: {
                    "conta_financeira_id"?: string,"created_at"?: string,"data"?: string,"empresa_id"?: string,"fonte"?: string,"id"?: string,"importacao_id"?: string | null,"informado_por"?: string | null,"saldo"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "extrato_saldos_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "extrato_saldos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extrato_saldos_empresa_id_importacao_id_fkey"
      columns: ["empresa_id","importacao_id"]
isOneToOne: false
      referencedRelation: "importacoes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "extrato_saldos_informado_por_fkey"
      columns: ["informado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"fechamento_etapas": {
                  Row: {
                    "competencia_id": string,"concluida_em": string | null,"concluida_por": string | null,"empresa_id": string,"etapa": string,"id": string,"iniciada_em": string | null,"observacao": string | null,"ordem": number,"responsavel_id": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "competencia_id": string,"concluida_em"?: string | null,"concluida_por"?: string | null,"empresa_id": string,"etapa": string,"id"?: string,"iniciada_em"?: string | null,"observacao"?: string | null,"ordem": number,"responsavel_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "competencia_id"?: string,"concluida_em"?: string | null,"concluida_por"?: string | null,"empresa_id"?: string,"etapa"?: string,"id"?: string,"iniciada_em"?: string | null,"observacao"?: string | null,"ordem"?: number,"responsavel_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fechamento_etapas_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_etapas_concluida_por_fkey"
      columns: ["concluida_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_etapas_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_etapas_responsavel_id_fkey"
      columns: ["responsavel_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"fechamento_pendencias": {
                  Row: {
                    "competencia_id": string,"criada_em": string,"criada_por": string | null,"descricao": string,"empresa_id": string,"etapa": string | null,"id": string,"impeditiva": boolean,"resolucao": string | null,"resolvida_em": string | null,"resolvida_por": string | null,"status": string,"visivel_cliente": boolean
                  }
                  Insert: {
                    "competencia_id": string,"criada_em"?: string,"criada_por"?: string | null,"descricao": string,"empresa_id": string,"etapa"?: string | null,"id"?: string,"impeditiva"?: boolean,"resolucao"?: string | null,"resolvida_em"?: string | null,"resolvida_por"?: string | null,"status"?: string,"visivel_cliente"?: boolean
                  }
                  Update: {
                    "competencia_id"?: string,"criada_em"?: string,"criada_por"?: string | null,"descricao"?: string,"empresa_id"?: string,"etapa"?: string | null,"id"?: string,"impeditiva"?: boolean,"resolucao"?: string | null,"resolvida_em"?: string | null,"resolvida_por"?: string | null,"status"?: string,"visivel_cliente"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "fechamento_pendencias_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_pendencias_criada_por_fkey"
      columns: ["criada_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_pendencias_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fechamento_pendencias_resolvida_por_fkey"
      columns: ["resolvida_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"importacoes": {
                  Row: {
                    "arquivo_nome": string | null,"arquivo_sha256": string | null,"chave_idempotencia": string,"conta_financeira_id": string | null,"created_at": string,"criado_por": string | null,"data_saldo_final": string | null,"desfeita_em": string | null,"desfeita_por": string | null,"documento_id": string | null,"empresa_id": string,"erros": NonNullable<Json>,"id": string,"mapeamento": Json | null,"motivo_desfazer": string | null,"opcoes": Json | null,"periodo_fim": string | null,"periodo_inicio": string | null,"saldo_final_extrato": number | null,"soma_creditos": number,"soma_debitos": number,"status": string,"tipo": string,"total_duplicadas": number,"total_invalidas": number,"total_linhas": number,"total_novas": number,"total_periodo_fechado": number
                  }
                  Insert: {
                    "arquivo_nome"?: string | null,"arquivo_sha256"?: string | null,"chave_idempotencia": string,"conta_financeira_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"data_saldo_final"?: string | null,"desfeita_em"?: string | null,"desfeita_por"?: string | null,"documento_id"?: string | null,"empresa_id": string,"erros"?: NonNullable<Json>,"id"?: string,"mapeamento"?: Json | null,"motivo_desfazer"?: string | null,"opcoes"?: Json | null,"periodo_fim"?: string | null,"periodo_inicio"?: string | null,"saldo_final_extrato"?: number | null,"soma_creditos"?: number,"soma_debitos"?: number,"status"?: string,"tipo": string,"total_duplicadas"?: number,"total_invalidas"?: number,"total_linhas"?: number,"total_novas"?: number,"total_periodo_fechado"?: number
                  }
                  Update: {
                    "arquivo_nome"?: string | null,"arquivo_sha256"?: string | null,"chave_idempotencia"?: string,"conta_financeira_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"data_saldo_final"?: string | null,"desfeita_em"?: string | null,"desfeita_por"?: string | null,"documento_id"?: string | null,"empresa_id"?: string,"erros"?: NonNullable<Json>,"id"?: string,"mapeamento"?: Json | null,"motivo_desfazer"?: string | null,"opcoes"?: Json | null,"periodo_fim"?: string | null,"periodo_inicio"?: string | null,"saldo_final_extrato"?: number | null,"soma_creditos"?: number,"soma_debitos"?: number,"status"?: string,"tipo"?: string,"total_duplicadas"?: number,"total_invalidas"?: number,"total_linhas"?: number,"total_novas"?: number,"total_periodo_fechado"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "importacoes_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "importacoes_desfeita_por_fkey"
      columns: ["desfeita_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "importacoes_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "importacoes_empresa_id_documento_id_fkey"
      columns: ["empresa_id","documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "importacoes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "bloqueado_ate": string | null,"chave_idempotencia": string | null,"concluido_em": string | null,"created_at": string,"empresa_id": string | null,"erro": string | null,"executar_apos": string,"id": number,"iniciado_em": string | null,"max_tentativas": number,"payload": NonNullable<Json>,"prioridade": number,"resultado": Json | null,"status": string,"tentativas": number,"tipo": string,"worker": string | null
                  }
                  Insert: {
                    "bloqueado_ate"?: string | null,"chave_idempotencia"?: string | null,"concluido_em"?: string | null,"created_at"?: string,"empresa_id"?: string | null,"erro"?: string | null,"executar_apos"?: string,"id"?: never,"iniciado_em"?: string | null,"max_tentativas"?: number,"payload"?: NonNullable<Json>,"prioridade"?: number,"resultado"?: Json | null,"status"?: string,"tentativas"?: number,"tipo": string,"worker"?: string | null
                  }
                  Update: {
                    "bloqueado_ate"?: string | null,"chave_idempotencia"?: string | null,"concluido_em"?: string | null,"created_at"?: string,"empresa_id"?: string | null,"erro"?: string | null,"executar_apos"?: string,"id"?: never,"iniciado_em"?: string | null,"max_tentativas"?: number,"payload"?: NonNullable<Json>,"prioridade"?: number,"resultado"?: Json | null,"status"?: string,"tentativas"?: number,"tipo"?: string,"worker"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"lancamento_documentos": {
                  Row: {
                    "documento_id": string,"empresa_id": string,"lancamento_id": string,"tipo_vinculo": string,"vinculado_em": string,"vinculado_por": string | null
                  }
                  Insert: {
                    "documento_id": string,"empresa_id": string,"lancamento_id": string,"tipo_vinculo"?: string,"vinculado_em"?: string,"vinculado_por"?: string | null
                  }
                  Update: {
                    "documento_id"?: string,"empresa_id"?: string,"lancamento_id"?: string,"tipo_vinculo"?: string,"vinculado_em"?: string,"vinculado_por"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lancamento_documentos_empresa_id_documento_id_fkey"
      columns: ["empresa_id","documento_id"]
isOneToOne: false
      referencedRelation: "documentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamento_documentos_empresa_id_lancamento_id_fkey"
      columns: ["empresa_id","lancamento_id"]
isOneToOne: false
      referencedRelation: "lancamentos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamento_documentos_vinculado_por_fkey"
      columns: ["vinculado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"lancamentos": {
                  Row: {
                    "cancelado_em": string | null,"cancelado_por": string | null,"categoria_id": string | null,"centro_custo_id": string | null,"chave_importacao": string | null,"confirmado_em": string | null,"confirmado_por": string | null,"conta_financeira_id": string | null,"contraparte_id": string | null,"created_at": string,"criado_por": string | null,"data_competencia": string,"data_ultimo_pagamento": string | null,"data_vencimento": string,"descricao": string,"documento_fiscal_id": string | null,"empresa_id": string,"id": string,"importacao_id": string | null,"motivo_cancelamento": string | null,"numero_documento": string | null,"observacoes": string | null,"origem": string,"origem_referencia": string | null,"parcela_numero": number | null,"parcela_total": number | null,"parcelamento_id": string | null,"projeto_id": string | null,"recorrencia_id": string | null,"situacao": string,"status_revisao": string,"tipo": string,"updated_at": string,"valor_baixado": number,"valor_previsto": number,"valor_realizado": number
                  }
                  Insert: {
                    "cancelado_em"?: string | null,"cancelado_por"?: string | null,"categoria_id"?: string | null,"centro_custo_id"?: string | null,"chave_importacao"?: string | null,"confirmado_em"?: string | null,"confirmado_por"?: string | null,"conta_financeira_id"?: string | null,"contraparte_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"data_competencia": string,"data_ultimo_pagamento"?: string | null,"data_vencimento": string,"descricao": string,"documento_fiscal_id"?: string | null,"empresa_id": string,"id"?: string,"importacao_id"?: string | null,"motivo_cancelamento"?: string | null,"numero_documento"?: string | null,"observacoes"?: string | null,"origem"?: string,"origem_referencia"?: string | null,"parcela_numero"?: number | null,"parcela_total"?: number | null,"parcelamento_id"?: string | null,"projeto_id"?: string | null,"recorrencia_id"?: string | null,"situacao"?: string,"status_revisao"?: string,"tipo": string,"updated_at"?: string,"valor_baixado"?: number,"valor_previsto": number,"valor_realizado"?: number
                  }
                  Update: {
                    "cancelado_em"?: string | null,"cancelado_por"?: string | null,"categoria_id"?: string | null,"centro_custo_id"?: string | null,"chave_importacao"?: string | null,"confirmado_em"?: string | null,"confirmado_por"?: string | null,"conta_financeira_id"?: string | null,"contraparte_id"?: string | null,"created_at"?: string,"criado_por"?: string | null,"data_competencia"?: string,"data_ultimo_pagamento"?: string | null,"data_vencimento"?: string,"descricao"?: string,"documento_fiscal_id"?: string | null,"empresa_id"?: string,"id"?: string,"importacao_id"?: string | null,"motivo_cancelamento"?: string | null,"numero_documento"?: string | null,"observacoes"?: string | null,"origem"?: string,"origem_referencia"?: string | null,"parcela_numero"?: number | null,"parcela_total"?: number | null,"parcelamento_id"?: string | null,"projeto_id"?: string | null,"recorrencia_id"?: string | null,"situacao"?: string,"status_revisao"?: string,"tipo"?: string,"updated_at"?: string,"valor_baixado"?: number,"valor_previsto"?: number,"valor_realizado"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lancamentos_cancelado_por_fkey"
      columns: ["cancelado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lancamentos_confirmado_por_fkey"
      columns: ["confirmado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lancamentos_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lancamentos_documento_fiscal_fk"
      columns: ["empresa_id","documento_fiscal_id"]
isOneToOne: false
      referencedRelation: "documentos_fiscais"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_categoria_id_fkey"
      columns: ["empresa_id","categoria_id"]
isOneToOne: false
      referencedRelation: "categorias_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_centro_custo_id_fkey"
      columns: ["empresa_id","centro_custo_id"]
isOneToOne: false
      referencedRelation: "centros_custo"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_contraparte_id_fkey"
      columns: ["empresa_id","contraparte_id"]
isOneToOne: false
      referencedRelation: "contrapartes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_projeto_id_fkey"
      columns: ["empresa_id","projeto_id"]
isOneToOne: false
      referencedRelation: "projetos"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_empresa_id_recorrencia_id_fkey"
      columns: ["empresa_id","recorrencia_id"]
isOneToOne: false
      referencedRelation: "recorrencias"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "lancamentos_importacao_fk"
      columns: ["empresa_id","importacao_id"]
isOneToOne: false
      referencedRelation: "importacoes"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"lembretes": {
                  Row: {
                    "canais": (string)[],"competencia": string | null,"created_at": string,"data_referencia": string,"destinatarios": number,"empresa_id": string,"enviado_por": string | null,"id": string,"itens": (string)[],"mensagem": string | null,"regra": string | null,"tipo": string
                  }
                  Insert: {
                    "canais"?: (string)[],"competencia"?: string | null,"created_at"?: string,"data_referencia"?: string,"destinatarios"?: number,"empresa_id": string,"enviado_por"?: string | null,"id"?: string,"itens"?: (string)[],"mensagem"?: string | null,"regra"?: string | null,"tipo"?: string
                  }
                  Update: {
                    "canais"?: (string)[],"competencia"?: string | null,"created_at"?: string,"data_referencia"?: string,"destinatarios"?: number,"empresa_id"?: string,"enviado_por"?: string | null,"id"?: string,"itens"?: (string)[],"mensagem"?: string | null,"regra"?: string | null,"tipo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lembretes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lembretes_enviado_por_fkey"
      columns: ["enviado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"mensagens": {
                  Row: {
                    "autor_id": string | null,"conversa_id": string,"corpo": string,"created_at": string,"documento_ids": (string)[],"empresa_id": string,"id": string,"interna": boolean
                  }
                  Insert: {
                    "autor_id"?: string | null,"conversa_id": string,"corpo": string,"created_at"?: string,"documento_ids"?: (string)[],"empresa_id": string,"id"?: string,"interna"?: boolean
                  }
                  Update: {
                    "autor_id"?: string | null,"conversa_id"?: string,"corpo"?: string,"created_at"?: string,"documento_ids"?: (string)[],"empresa_id"?: string,"id"?: string,"interna"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "mensagens_autor_id_fkey"
      columns: ["autor_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensagens_conversa_id_fkey"
      columns: ["conversa_id"]
isOneToOne: false
      referencedRelation: "conversas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensagens_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"movimentos_bancarios": {
                  Row: {
                    "chave_dedupe": string,"conta_financeira_id": string,"created_at": string,"data": string,"descricao": string,"documento_contraparte": string | null,"empresa_id": string,"fitid": string | null,"id": string,"ignorado_em": string | null,"ignorado_motivo": string | null,"ignorado_por": string | null,"importacao_id": string | null,"numero_documento": string | null,"status_conciliacao": string,"tipo_transacao": string | null,"valor": number
                  }
                  Insert: {
                    "chave_dedupe": string,"conta_financeira_id": string,"created_at"?: string,"data": string,"descricao": string,"documento_contraparte"?: string | null,"empresa_id": string,"fitid"?: string | null,"id"?: string,"ignorado_em"?: string | null,"ignorado_motivo"?: string | null,"ignorado_por"?: string | null,"importacao_id"?: string | null,"numero_documento"?: string | null,"status_conciliacao"?: string,"tipo_transacao"?: string | null,"valor": number
                  }
                  Update: {
                    "chave_dedupe"?: string,"conta_financeira_id"?: string,"created_at"?: string,"data"?: string,"descricao"?: string,"documento_contraparte"?: string | null,"empresa_id"?: string,"fitid"?: string | null,"id"?: string,"ignorado_em"?: string | null,"ignorado_motivo"?: string | null,"ignorado_por"?: string | null,"importacao_id"?: string | null,"numero_documento"?: string | null,"status_conciliacao"?: string,"tipo_transacao"?: string | null,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "movimentos_bancarios_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "movimentos_bancarios_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "movimentos_bancarios_empresa_id_importacao_id_fkey"
      columns: ["empresa_id","importacao_id"]
isOneToOne: false
      referencedRelation: "importacoes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "movimentos_bancarios_ignorado_por_fkey"
      columns: ["ignorado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"notificacoes": {
                  Row: {
                    "corpo": string | null,"created_at": string,"empresa_id": string | null,"id": string,"lida_em": string | null,"link": string | null,"tipo": string,"titulo": string,"user_id": string
                  }
                  Insert: {
                    "corpo"?: string | null,"created_at"?: string,"empresa_id"?: string | null,"id"?: string,"lida_em"?: string | null,"link"?: string | null,"tipo": string,"titulo": string,"user_id": string
                  }
                  Update: {
                    "corpo"?: string | null,"created_at"?: string,"empresa_id"?: string | null,"id"?: string,"lida_em"?: string | null,"link"?: string | null,"tipo"?: string,"titulo"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notificacoes_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notificacoes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"perfis": {
                  Row: {
                    "aceite_termos_em": string | null,"aceite_termos_versao": string | null,"anonimizado_em": string | null,"ativo": boolean,"cargo": string | null,"created_at": string,"email": string,"id": string,"nome": string,"preferencias": NonNullable<Json>,"telefone": string | null,"tipo": string,"ultimo_acesso_em": string | null,"updated_at": string
                  }
                  Insert: {
                    "aceite_termos_em"?: string | null,"aceite_termos_versao"?: string | null,"anonimizado_em"?: string | null,"ativo"?: boolean,"cargo"?: string | null,"created_at"?: string,"email": string,"id": string,"nome": string,"preferencias"?: NonNullable<Json>,"telefone"?: string | null,"tipo"?: string,"ultimo_acesso_em"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "aceite_termos_em"?: string | null,"aceite_termos_versao"?: string | null,"anonimizado_em"?: string | null,"ativo"?: boolean,"cargo"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"nome"?: string,"preferencias"?: NonNullable<Json>,"telefone"?: string | null,"tipo"?: string,"ultimo_acesso_em"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"politicas_retencao": {
                  Row: {
                    "anos": number,"categoria_codigo": string,"observacao": string | null,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "anos": number,"categoria_codigo": string,"observacao"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "anos"?: number,"categoria_codigo"?: string,"observacao"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "politicas_retencao_categoria_codigo_fkey"
      columns: ["categoria_codigo"]
isOneToOne: true
      referencedRelation: "categorias_documento"
      referencedColumns: ["codigo"]
    },{
      foreignKeyName: "politicas_retencao_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"projetos": {
                  Row: {
                    "ativo": boolean,"codigo": string | null,"created_at": string,"empresa_id": string,"fim": string | null,"id": string,"inicio": string | null,"nome": string
                  }
                  Insert: {
                    "ativo"?: boolean,"codigo"?: string | null,"created_at"?: string,"empresa_id": string,"fim"?: string | null,"id"?: string,"inicio"?: string | null,"nome": string
                  }
                  Update: {
                    "ativo"?: boolean,"codigo"?: string | null,"created_at"?: string,"empresa_id"?: string,"fim"?: string | null,"id"?: string,"inicio"?: string | null,"nome"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projetos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                },"recorrencias": {
                  Row: {
                    "ativa": boolean,"categoria_id": string,"centro_custo_id": string | null,"conta_financeira_id": string | null,"contraparte_id": string | null,"created_at": string,"data_fim": string | null,"data_inicio": string,"descricao": string,"dia_vencimento": number | null,"empresa_id": string,"frequencia": string,"id": string,"meses_a_frente": number,"projeto_id": string | null,"tipo": string,"ultima_data_gerada": string | null,"updated_at": string,"valor": number
                  }
                  Insert: {
                    "ativa"?: boolean,"categoria_id": string,"centro_custo_id"?: string | null,"conta_financeira_id"?: string | null,"contraparte_id"?: string | null,"created_at"?: string,"data_fim"?: string | null,"data_inicio": string,"descricao": string,"dia_vencimento"?: number | null,"empresa_id": string,"frequencia"?: string,"id"?: string,"meses_a_frente"?: number,"projeto_id"?: string | null,"tipo": string,"ultima_data_gerada"?: string | null,"updated_at"?: string,"valor": number
                  }
                  Update: {
                    "ativa"?: boolean,"categoria_id"?: string,"centro_custo_id"?: string | null,"conta_financeira_id"?: string | null,"contraparte_id"?: string | null,"created_at"?: string,"data_fim"?: string | null,"data_inicio"?: string,"descricao"?: string,"dia_vencimento"?: number | null,"empresa_id"?: string,"frequencia"?: string,"id"?: string,"meses_a_frente"?: number,"projeto_id"?: string | null,"tipo"?: string,"ultima_data_gerada"?: string | null,"updated_at"?: string,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "recorrencias_empresa_id_categoria_id_fkey"
      columns: ["empresa_id","categoria_id"]
isOneToOne: false
      referencedRelation: "categorias_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "recorrencias_empresa_id_centro_custo_id_fkey"
      columns: ["empresa_id","centro_custo_id"]
isOneToOne: false
      referencedRelation: "centros_custo"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "recorrencias_empresa_id_conta_financeira_id_fkey"
      columns: ["empresa_id","conta_financeira_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "recorrencias_empresa_id_contraparte_id_fkey"
      columns: ["empresa_id","contraparte_id"]
isOneToOne: false
      referencedRelation: "contrapartes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "recorrencias_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recorrencias_empresa_id_projeto_id_fkey"
      columns: ["empresa_id","projeto_id"]
isOneToOne: false
      referencedRelation: "projetos"
      referencedColumns: ["empresa_id","id"]
    }
                  ]
                },"relatorio_acessos": {
                  Row: {
                    "empresa_id": string,"id": number,"ocorrido_em": string,"relatorio_id": string,"tipo": string,"user_id": string | null
                  }
                  Insert: {
                    "empresa_id": string,"id"?: never,"ocorrido_em"?: string,"relatorio_id": string,"tipo": string,"user_id"?: string | null
                  }
                  Update: {
                    "empresa_id"?: string,"id"?: never,"ocorrido_em"?: string,"relatorio_id"?: string,"tipo"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "relatorio_acessos_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relatorio_acessos_relatorio_id_fkey"
      columns: ["relatorio_id"]
isOneToOne: false
      referencedRelation: "relatorios_publicados"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relatorio_acessos_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"relatorios_publicados": {
                  Row: {
                    "atualizado_em": string,"comentarios_contador": string | null,"competencia": string | null,"dados": NonNullable<Json>,"empresa_id": string,"gerado_em": string,"gerado_por": string | null,"id": string,"limitacoes": NonNullable<Json>,"periodo_fim": string,"periodo_inicio": string,"publicado_em": string | null,"publicado_por": string | null,"resumo_texto": string | null,"situacao": string,"status": string,"substituido_por": string | null,"tipo": string,"titulo": string,"versao": number
                  }
                  Insert: {
                    "atualizado_em"?: string,"comentarios_contador"?: string | null,"competencia"?: string | null,"dados"?: NonNullable<Json>,"empresa_id": string,"gerado_em"?: string,"gerado_por"?: string | null,"id"?: string,"limitacoes"?: NonNullable<Json>,"periodo_fim": string,"periodo_inicio": string,"publicado_em"?: string | null,"publicado_por"?: string | null,"resumo_texto"?: string | null,"situacao"?: string,"status"?: string,"substituido_por"?: string | null,"tipo": string,"titulo": string,"versao"?: number
                  }
                  Update: {
                    "atualizado_em"?: string,"comentarios_contador"?: string | null,"competencia"?: string | null,"dados"?: NonNullable<Json>,"empresa_id"?: string,"gerado_em"?: string,"gerado_por"?: string | null,"id"?: string,"limitacoes"?: NonNullable<Json>,"periodo_fim"?: string,"periodo_inicio"?: string,"publicado_em"?: string | null,"publicado_por"?: string | null,"resumo_texto"?: string | null,"situacao"?: string,"status"?: string,"substituido_por"?: string | null,"tipo"?: string,"titulo"?: string,"versao"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "relatorios_publicados_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relatorios_publicados_gerado_por_fkey"
      columns: ["gerado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relatorios_publicados_publicado_por_fkey"
      columns: ["publicado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relatorios_publicados_substituido_por_fkey"
      columns: ["substituido_por"]
isOneToOne: false
      referencedRelation: "relatorios_publicados"
      referencedColumns: ["id"]
    }
                  ]
                },"solicitacoes_titular": {
                  Row: {
                    "created_at": string,"descricao": string | null,"email": string | null,"id": string,"respondida_em": string | null,"respondida_por": string | null,"resposta": string | null,"status": string,"tipo": string,"user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"descricao"?: string | null,"email"?: string | null,"id"?: string,"respondida_em"?: string | null,"respondida_por"?: string | null,"resposta"?: string | null,"status"?: string,"tipo": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"descricao"?: string | null,"email"?: string | null,"id"?: string,"respondida_em"?: string | null,"respondida_por"?: string | null,"resposta"?: string | null,"status"?: string,"tipo"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "solicitacoes_titular_respondida_por_fkey"
      columns: ["respondida_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "solicitacoes_titular_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    }
                  ]
                },"transferencias": {
                  Row: {
                    "conciliacao_id": string | null,"conta_destino_id": string,"conta_origem_id": string,"created_at": string,"criado_por": string | null,"data": string,"descricao": string | null,"empresa_id": string,"id": string,"origem": string,"tipo": string,"valor": number
                  }
                  Insert: {
                    "conciliacao_id"?: string | null,"conta_destino_id": string,"conta_origem_id": string,"created_at"?: string,"criado_por"?: string | null,"data": string,"descricao"?: string | null,"empresa_id": string,"id"?: string,"origem"?: string,"tipo"?: string,"valor": number
                  }
                  Update: {
                    "conciliacao_id"?: string | null,"conta_destino_id"?: string,"conta_origem_id"?: string,"created_at"?: string,"criado_por"?: string | null,"data"?: string,"descricao"?: string | null,"empresa_id"?: string,"id"?: string,"origem"?: string,"tipo"?: string,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "transferencias_conciliacao_fk"
      columns: ["empresa_id","conciliacao_id"]
isOneToOne: false
      referencedRelation: "conciliacoes"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "transferencias_criado_por_fkey"
      columns: ["criado_por"]
isOneToOne: false
      referencedRelation: "perfis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transferencias_empresa_id_conta_destino_id_fkey"
      columns: ["empresa_id","conta_destino_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "transferencias_empresa_id_conta_origem_id_fkey"
      columns: ["empresa_id","conta_origem_id"]
isOneToOne: false
      referencedRelation: "contas_financeiras"
      referencedColumns: ["empresa_id","id"]
    },{
      foreignKeyName: "transferencias_empresa_id_fkey"
      columns: ["empresa_id"]
isOneToOne: false
      referencedRelation: "empresas"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "adicionar_item_checklist":
{ Args: { "p_categoria": string,"p_competencia": string,"p_descricao": string,"p_empresa_id": string,"p_obrigatorio"?: boolean,"p_prazo": string,"p_quantidade_minima"?: number,"p_responsavel_cliente_id"?: string,"p_responsavel_equipe_id"?: string,"p_titulo": string }; Returns: string
                           },
"administrar_usuario":
{ Args: { "p_ativo": boolean,"p_cargo"?: string,"p_tipo": string,"p_user_id": string }; Returns: undefined
                           },
"alterar_status_conversa":
{ Args: { "p_conversa_id": string,"p_status": string }; Returns: undefined
                           },
"alterar_status_documento":
{ Args: { "p_documento_id": string,"p_motivo"?: string,"p_status": string }; Returns: undefined
                           },
"anonimizar_usuario":
{ Args: { "p_motivo": string,"p_user_id": string }; Returns: undefined
                           },
"aplicar_checklist_padrao":
{ Args: { "p_empresa_id": string }; Returns: number
                           },
"atualizar_documento":
{ Args: { "p_categoria": string,"p_checklist_item_id"?: string,"p_competencia": string,"p_documento_id": string,"p_observacao"?: string,"p_titulo"?: string,"p_valor"?: number,"p_vencimento"?: string }; Returns: undefined
                           },
"atualizar_etapa_fechamento":
{ Args: { "p_etapa_id": string,"p_observacao"?: string,"p_responsavel_id"?: string,"p_status": string }; Returns: undefined
                           },
"atualizar_item_checklist":
{ Args: { "p_descricao": string,"p_item_id": string,"p_obrigatorio": boolean,"p_observacao_equipe"?: string,"p_prazo": string,"p_quantidade_minima": number,"p_responsavel_cliente_id": string,"p_responsavel_equipe_id": string,"p_titulo": string }; Returns: undefined
                           },
"atualizar_membro":
{ Args: { "p_membro_id": string,"p_papel": string,"p_permissoes": (string)[] }; Returns: undefined
                           },
"avaliar_documento_apos_fechamento":
{ Args: { "p_documento_id": string,"p_parecer": string }; Returns: undefined
                           },
"classificar_movimento":
{ Args: { "p_categoria_id": string,"p_centro_custo_id"?: string,"p_contraparte_id"?: string,"p_data_competencia"?: string,"p_descricao"?: string,"p_documento_ids"?: (string)[],"p_movimento_id": string,"p_projeto_id"?: string }; Returns: Json
                           },
"conciliar_manual":
{ Args: { "p_baixas"?: (string)[],"p_conta_contrapartida"?: string,"p_empresa_id": string,"p_lancamentos"?: (string)[],"p_movimentos": (string)[],"p_observacao"?: string,"p_tipo"?: string,"p_transferencias"?: (string)[],"p_tratamento"?: string }; Returns: Json
                           },
"concluir_item_checklist":
{ Args: { "p_item_id": string,"p_observacao"?: string }; Returns: undefined
                           },
"conferencia_saldos":
{ Args: { "p_empresa_id": string,"p_fim": string,"p_inicio": string }; Returns: {
              "conta_id": string,"conta_nome": string,"conta_tipo": string,"diferenca": number,"entradas_sistema": number,"movimentos_importados": number,"movimentos_pendentes": number,"movimentos_total": number,"saidas_sistema": number,"saldo_extrato": number,"saldo_extrato_data": string,"saldo_final_sistema": number,"saldo_inicial_sistema": number
            }[]
                           },
"configurar_empresa_padrao":
{ Args: { "p_empresa_id": string }; Returns: Json
                           },
"confirmar_conciliacao":
{ Args: { "p_conciliacao_id": string,"p_conta_contrapartida"?: string,"p_observacao"?: string,"p_tratamento"?: string }; Returns: Json
                           },
"confirmar_upload":
{ Args: { "p_versao_id": string }; Returns: Json
                           },
"criar_conversa":
{ Args: { "p_assunto": string,"p_checklist_item_id"?: string,"p_competencia"?: string,"p_corpo": string,"p_documento_id"?: string,"p_documento_ids"?: (string)[],"p_empresa_id": string,"p_tipo"?: string }; Returns: string
                           },
"criar_documento":
{ Args: { "p_categoria": string,"p_checklist_item_id"?: string,"p_competencia": string,"p_empresa_id": string,"p_forcar_duplicado"?: boolean,"p_mime": string,"p_nome_arquivo": string,"p_observacao"?: string,"p_origem"?: string,"p_sha256": string,"p_tamanho": number,"p_titulo"?: string,"p_valor"?: number,"p_vencimento"?: string }; Returns: Json
                           },
"criar_empresa":
{ Args: { "p_dados": Json }; Returns: string
                           },
"criar_parcelamento":
{ Args: { "p_categoria_id": string,"p_centro_custo_id"?: string,"p_competencia_por_parcela"?: boolean,"p_conta_financeira_id"?: string,"p_contraparte_id"?: string,"p_data_competencia": string,"p_descricao": string,"p_empresa_id": string,"p_numero_documento"?: string,"p_observacoes"?: string,"p_parcelas": number,"p_primeiro_vencimento": string,"p_projeto_id"?: string,"p_tipo": string,"p_valor_total": number }; Returns: string
                           },
"criar_solicitacao_titular":
{ Args: { "p_descricao": string,"p_tipo": string }; Returns: string
                           },
"definir_logo_escritorio":
{ Args: { "p_path": string }; Returns: undefined
                           },
"desfazer_conciliacao":
{ Args: { "p_conciliacao_id": string,"p_motivo": string }; Returns: undefined
                           },
"desfazer_importacao":
{ Args: { "p_importacao_id": string,"p_motivo": string }; Returns: Json
                           },
"documentos_retencao_vencida":
{ Args: { "p_limite"?: number }; Returns: {
              "anos_retencao": number,"categoria_codigo": string,"competencia": string,"documento_id": string,"empresa_id": string,"empresa_nome": string,"nome_original": string,"vence_em": string
            }[]
                           },
"documentos_sem_vinculo":
{ Args: { "p_empresa_id": string,"p_fim": string,"p_inicio": string }; Returns: {
              "apos_fechamento_avaliado_em": string | null,
"apos_fechamento_avaliado_por": string | null,
"apos_fechamento_parecer": string | null,
"categoria_codigo": string,
"checklist_item_id": string | null,
"competencia": string,
"created_at": string,
"direcao": string,
"duplicado_de": string | null,
"empresa_id": string,
"enviado_em": string | null,
"enviado_por": string | null,
"excluido_em": string | null,
"excluido_por": string | null,
"expurgado_em": string | null,
"expurgado_por": string | null,
"expurgo_motivo": string | null,
"extensao": string | null,
"extracao": Json | null,
"id": string,
"mime": string | null,
"motivo_exclusao": string | null,
"nome_original": string,
"observacao": string | null,
"origem": string,
"processamento_detalhes": Json | null,
"processamento_status": string,
"publicado_em": string | null,
"recebido_apos_fechamento": boolean,
"requer_conferencia": boolean,
"sha256": string | null,
"status": string | null,
"status_alterado_em": string | null,
"status_alterado_por": string | null,
"status_motivo": string | null,
"storage_path": string | null,
"sugestao": Json | null,
"tamanho": number | null,
"titulo": string | null,
"updated_at": string,
"upload_status": string,
"valor": number | null,
"vencimento": string | null,
"verificacao_detalhes": string | null,
"verificacao_status": string,
"versao_atual": number,
"zip_caminho": string | null,
"zip_origem_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "documentos"
        isOneToOne: false
        isSetofReturn: true
      } },
"encerrar_sessao":
{ Args: { "p_sessao_id": string }; Returns: undefined
                           },
"encerrar_sessoes_usuario":
{ Args: { "p_user_id": string }; Returns: number
                           },
"enviar_lembrete_manual":
{ Args: { "p_competencia": string,"p_empresa_id": string,"p_mensagem"?: string }; Returns: string
                           },
"enviar_mensagem":
{ Args: { "p_conversa_id": string,"p_corpo": string,"p_documento_ids"?: (string)[],"p_interna"?: boolean }; Returns: string
                           },
"escritorio_publico":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"estado_acesso":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"excluir_documento":
{ Args: { "p_documento_id": string,"p_motivo": string }; Returns: undefined
                           },
"excluir_rascunho_relatorio":
{ Args: { "p_id": string }; Returns: undefined
                           },
"exportar_meus_dados":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"expurgar_documentos":
{ Args: { "p_ids": (string)[],"p_motivo": string }; Returns: number
                           },
"fechar_competencia":
{ Args: { "p_competencia": string,"p_empresa_id": string,"p_observacao"?: string }; Returns: undefined
                           },
"gerar_checklist_competencia":
{ Args: { "p_competencia": string,"p_empresa_id": string }; Returns: number
                           },
"gerar_recorrencias_empresa":
{ Args: { "p_empresa_id": string }; Returns: number
                           },
"ignorar_movimento":
{ Args: { "p_ignorar": boolean,"p_motivo"?: string,"p_movimento_id": string }; Returns: undefined
                           },
"importar_extrato":
{ Args: { "p_arquivo_nome": string,"p_arquivo_sha256": string,"p_chave_idempotencia": string,"p_conta_id": string,"p_data_saldo_final"?: string,"p_documento_id": string,"p_empresa_id": string,"p_erros"?: Json,"p_linhas": Json,"p_mapeamento": Json,"p_saldo_final"?: number,"p_tipo": string,"p_total_invalidas"?: number }; Returns: Json
                           },
"importar_lancamentos":
{ Args: { "p_arquivo_nome": string,"p_arquivo_sha256": string,"p_chave_idempotencia": string,"p_documento_id": string,"p_empresa_id": string,"p_erros"?: Json,"p_linhas": Json,"p_mapeamento": Json,"p_total_invalidas"?: number }; Returns: Json
                           },
"iniciar_fechamento":
{ Args: { "p_competencia": string,"p_empresa_id": string }; Returns: string
                           },
"jobs_concluir":
{ Args: { "p_id": number,"p_resultado"?: Json }; Returns: undefined
                           },
"jobs_falhar":
{ Args: { "p_erro": string,"p_id": number,"p_reprogramar_segundos"?: number }; Returns: undefined
                           },
"jobs_reservar":
{ Args: { "p_limite"?: number,"p_tipos"?: (string)[],"p_worker"?: string }; Returns: {
              "bloqueado_ate": string | null,
"chave_idempotencia": string | null,
"concluido_em": string | null,
"created_at": string,
"empresa_id": string | null,
"erro": string | null,
"executar_apos": string,
"id": number,
"iniciado_em": string | null,
"max_tentativas": number,
"payload": NonNullable<Json>,
"prioridade": number,
"resultado": Json | null,
"status": string,
"tentativas": number,
"tipo": string,
"worker": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"marcar_conversa_lida":
{ Args: { "p_conversa_id": string }; Returns: undefined
                           },
"minhas_sessoes":
{ Args: Record<PropertyKey, never>; Returns: {
              "aal": string,"atual": boolean,"atualizada_em": string,"criada_em": string,"id": string,"ip": string,"user_agent": string
            }[]
                           },
"movimentos_sem_comprovante":
{ Args: { "p_empresa_id": string,"p_fim": string,"p_inicio": string }; Returns: {
              "chave_dedupe": string,
"conta_financeira_id": string,
"created_at": string,
"data": string,
"descricao": string,
"documento_contraparte": string | null,
"empresa_id": string,
"fitid": string | null,
"id": string,
"ignorado_em": string | null,
"ignorado_motivo": string | null,
"ignorado_por": string | null,
"importacao_id": string | null,
"numero_documento": string | null,
"status_conciliacao": string,
"tipo_transacao": string | null,
"valor": number
            }[]
                          SetofOptions: {
        from: "*"
        to: "movimentos_bancarios"
        isOneToOne: false
        isSetofReturn: true
      } },
"publicar_relatorio":
{ Args: { "p_id": string }; Returns: Json
                           },
"qualidade_dados":
{ Args: { "p_empresa_id": string,"p_fim": string,"p_inicio": string }; Returns: Json
                           },
"reabrir_competencia":
{ Args: { "p_competencia": string,"p_empresa_id": string,"p_justificativa": string }; Returns: undefined
                           },
"reabrir_item_checklist":
{ Args: { "p_item_id": string,"p_motivo": string }; Returns: undefined
                           },
"registrar_aceite_termos":
{ Args: { "p_ip"?: string,"p_user_agent"?: string,"p_versao": string }; Returns: undefined
                           },
"registrar_acesso_documento":
{ Args: { "p_documento_id": string,"p_ip"?: string,"p_tipo": string,"p_user_agent"?: string,"p_versao"?: number }; Returns: Json
                           },
"registrar_acesso_relatorio":
{ Args: { "p_id": string,"p_tipo": string }; Returns: undefined
                           },
"registrar_compra_cartao":
{ Args: { "p_categoria_id": string,"p_centro_custo_id"?: string,"p_conta_cartao_id": string,"p_contraparte_id"?: string,"p_data_compra": string,"p_descricao": string,"p_empresa_id": string,"p_parcelas"?: number,"p_projeto_id"?: string,"p_valor": number }; Returns: string
                           },
"registrar_convite":
{ Args: { "p_email": string,"p_empresa_id": string,"p_envio_erro"?: string,"p_envio_status": string,"p_nome": string,"p_papel": string,"p_permissoes": (string)[],"p_tipo_usuario": string,"p_user_id": string }; Returns: string
                           },
"registrar_evento":
{ Args: { "p_acao": string,"p_detalhes"?: Json,"p_empresa_id"?: string,"p_entidade": string,"p_entidade_id"?: string,"p_ip"?: string,"p_user_agent"?: string }; Returns: undefined
                           },
"registrar_login":
{ Args: { "p_ip"?: string,"p_user_agent"?: string }; Returns: Json
                           },
"registrar_parcela_emprestimo":
{ Args: { "p_conta_id": string,"p_contraparte_id"?: string,"p_data_vencimento": string,"p_descricao": string,"p_empresa_id": string,"p_pago_em"?: string,"p_valor_juros": number,"p_valor_principal": number }; Returns: Json
                           },
"registrar_pendencia_fechamento":
{ Args: { "p_competencia_id": string,"p_descricao": string,"p_etapa": string,"p_impeditiva"?: boolean,"p_visivel_cliente"?: boolean }; Returns: string
                           },
"registrar_sugestoes_conciliacao":
{ Args: { "p_empresa_id": string,"p_sugestoes": Json }; Returns: number
                           },
"registrar_venda_maquininha":
{ Args: { "p_categoria_receita_id": string,"p_centro_custo_id"?: string,"p_conta_recebimento_id": string,"p_contraparte_id"?: string,"p_data_recebimento": string,"p_data_venda": string,"p_descricao": string,"p_empresa_id": string,"p_recebido"?: boolean,"p_taxa": number,"p_valor_bruto": number }; Returns: string
                           },
"registrar_xml_fiscal":
{ Args: { "p_dados": Json,"p_documento_id": string }; Returns: Json
                           },
"rejeitar_sugestao_conciliacao":
{ Args: { "p_conciliacao_id": string,"p_motivo"?: string }; Returns: undefined
                           },
"relatorio_dre_composicao":
{ Args: { "p_categoria_id"?: string,"p_centro_custo_id"?: string,"p_empresa_id": string,"p_fim": string,"p_inicio": string,"p_tipos": (string)[] }; Returns: {
              "baixa_id": string,"categoria_nome": string,"contraparte": string,"data": string,"descricao": string,"lancamento_id": string,"origem": string,"tipo_categoria": string,"valor": number
            }[]
                           },
"relatorio_dre_linhas":
{ Args: { "p_centro_custo_id"?: string,"p_empresa_id": string,"p_fim": string,"p_inicio": string,"p_projeto_id"?: string }; Returns: {
              "categoria_codigo": string,"categoria_id": string,"categoria_nome": string,"mes": string,"origem": string,"quantidade": number,"tipo": string,"valor": number
            }[]
                           },
"relatorio_fluxo_projetado":
{ Args: { "p_ate": string,"p_empresa_id": string }; Returns: {
              "categoria_nome": string,"contraparte": string,"data": string,"descricao": string,"entrada": number,"lancamento_id": string,"origem": string,"saida": number,"vencido": boolean
            }[]
                           },
"relatorio_fluxo_realizado":
{ Args: { "p_centro_custo_id"?: string,"p_contas"?: (string)[],"p_empresa_id": string,"p_fim": string,"p_inicio": string }; Returns: {
              "categoria_id": string,"categoria_nome": string,"conta_contrapartida_disponivel": boolean,"conta_contrapartida_id": string,"conta_disponivel": boolean,"conta_id": string,"conta_nome": string,"contraparte": string,"data": string,"descricao": string,"entrada": number,"grupo": string,"lancamento_id": string,"registro": string,"registro_id": string,"saida": number,"tipo_categoria": string
            }[]
                           },
"reprocessar_documento":
{ Args: { "p_documento_id": string }; Returns: number
                           },
"resolver_pendencia_fechamento":
{ Args: { "p_pendencia_id": string,"p_resolucao": string,"p_status": string }; Returns: undefined
                           },
"responder_solicitacao_titular":
{ Args: { "p_id": string,"p_resposta": string,"p_status": string }; Returns: undefined
                           },
"resumo_checklist":
{ Args: { "p_competencia": string,"p_empresa_id": string }; Returns: Json
                           },
"resumo_conciliacao_carteira":
{ Args: Record<PropertyKey, never>; Returns: {
              "conciliadas_30d": number,"empresa_id": string,"entradas_pendentes": number,"pendente_mais_antiga": string,"pendentes": number,"saidas_pendentes": number,"sugestoes": number,"ultima_importacao": string
            }[]
                           },
"resumo_financeiro_carteira":
{ Args: { "p_fim": string,"p_inicio": string }; Returns: {
              "contas_sem_saldo": number,"empresa_id": string,"pagar_30": number,"pagar_vencido": number,"receber_30": number,"receber_vencido": number,"receita": number,"resultado": number,"saldo_disponivel": number,"sugeridos": number
            }[]
                           },
"revisar_nao_aplica":
{ Args: { "p_aprovar": boolean,"p_item_id": string,"p_resposta"?: string }; Returns: undefined
                           },
"revogar_membro":
{ Args: { "p_membro_id": string,"p_motivo": string }; Returns: undefined
                           },
"rotina_diaria":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"saldo_conta":
{ Args: { "p_conta_id": string,"p_data": string }; Returns: number
                           },
"saldos_contas":
{ Args: { "p_data": string,"p_empresa_id": string }; Returns: {
              "compoe_saldo_disponivel": boolean,"conciliado_ate": string,"conta_id": string,"movimentos_pendentes": number,"nome": string,"saldo_extrato": number,"saldo_extrato_data": string,"saldo_sistema": number,"tipo": string,"ultimo_movimento_data": string
            }[]
                           },
"salvar_rascunho_relatorio":
{ Args: { "p_comentarios": string,"p_competencia": string,"p_dados": Json,"p_empresa_id": string,"p_fim": string,"p_id": string,"p_inicio": string,"p_limitacoes": Json,"p_resumo": string,"p_tipo": string,"p_titulo": string }; Returns: string
                           },
"sistema_bloquear_documento":
{ Args: { "p_documento_id": string,"p_motivo": string,"p_versao_id": string }; Returns: undefined
                           },
"sistema_notificar":
{ Args: { "p_corpo"?: string,"p_email"?: boolean,"p_empresa_id": string,"p_link"?: string,"p_tipo": string,"p_titulo": string,"p_user_id": string }; Returns: string
                           },
"sistema_notificar_equipe":
{ Args: { "p_corpo"?: string,"p_empresa_id": string,"p_link"?: string,"p_tipo": string,"p_titulo": string }; Returns: number
                           },
"solicitar_correcao_item":
{ Args: { "p_item_id": string,"p_motivo": string }; Returns: undefined
                           },
"solicitar_nao_aplica":
{ Args: { "p_item_id": string,"p_justificativa": string }; Returns: undefined
                           },
"substituir_documento":
{ Args: { "p_documento_id": string,"p_mime": string,"p_motivo": string,"p_nome_arquivo": string,"p_sha256": string,"p_tamanho": number }; Returns: Json
                           },
"vincular_membro":
{ Args: { "p_empresa_id": string,"p_papel": string,"p_permissoes"?: (string)[],"p_user_id": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
