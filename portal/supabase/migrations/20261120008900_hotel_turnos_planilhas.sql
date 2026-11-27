-- =============================================================================
-- Hotel:
--  1. Serviços extras de um período (dia ou mês), na conta do quarto e para
--     empresas, numa lista só — base das planilhas do dia e do mês.
--  2. Movimento do hotel num intervalo de horário (o turno da recepção ou o
--     dia): reservas feitas, check-ins, check-outs, cancelamentos, pagamentos,
--     estornos, consumo e serviços lançados e recibos de empresas, com quem
--     fez cada coisa. O caixa do turno é o caixa da loja (aberto pela pessoa,
--     com o nome do turno); aqui fica o que aconteceu nas reservas.
-- A recepção lê só pelo resultado destas funções (sem acesso ao Financeiro
-- nem ao cadastro de pessoas).
-- =============================================================================

create or replace function public.hotel_extras_periodo(p_empresa_id uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    raise exception 'Período inválido.';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'data', x ->> 'hora')
      from (
        -- Na conta do quarto do hóspede
        select jsonb_build_object(
          'data', i.data, 'hora', i.created_at, 'origem', 'hospede',
          'reserva_numero', r.numero, 'quarto', q.numero, 'cliente', h.nome, 'documento', null, 'solicitante', null, 'recibo_numero', null,
          'servico', i.descricao, 'natureza', coalesce(e.natureza, i.setor), 'unidade', e.unidade,
          'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'total', i.total,
          'pagamento', 'Conta do quarto',
          'situacao', case when i.cancelado_em is not null then 'cancelado' when r.status = 'encerrada' then 'cobrado no check-out' else 'na conta (hóspede na casa)' end,
          'lancado_por', p.nome, 'cancelado', i.cancelado_em is not null, 'motivo_cancelamento', i.motivo_cancelamento
        ) as x
          from public.hotel_conta_itens i
          join public.hotel_reservas r on r.id = i.reserva_id
          join public.hotel_quartos q on q.id = r.quarto_id
          join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.hotel_extras e on e.id = i.extra_id
          left join public.perfis p on p.id = i.lancado_por
         where i.empresa_id = p_empresa_id and i.extra_id is not null and i.data between p_de and p_ate
        union all
        -- Para empresas (recibo)
        select jsonb_build_object(
          'data', rc.data, 'hora', rc.created_at, 'origem', 'empresa',
          'reserva_numero', null, 'quarto', null, 'cliente', c.nome, 'documento', c.documento, 'solicitante', rc.solicitante, 'recibo_numero', rc.numero,
          'servico', it.descricao, 'natureza', it.natureza, 'unidade', it.unidade,
          'quantidade', it.quantidade, 'valor_unitario', it.valor_unitario, 'total', it.total,
          'pagamento', case when rc.pagamento = 'na_hora' then 'Na hora' else 'A prazo — vence ' || to_char(rc.vencimento, 'DD/MM/YYYY') end,
          'forma', rc.forma,
          'situacao', case
            when rc.cancelado_em is not null then 'cancelado'
            when l.situacao = 'quitado' then 'pago'
            when l.situacao = 'parcial' then 'pago em parte'
            when rc.vencimento < app.hoje() then 'vencido'
            else 'a receber' end,
          'lancado_por', p.nome, 'cancelado', rc.cancelado_em is not null, 'motivo_cancelamento', rc.motivo_cancelamento
        )
          from public.hotel_extras_recibo_itens it
          join public.hotel_extras_recibos rc on rc.id = it.recibo_id
          join public.contrapartes c on c.id = rc.contraparte_id
          left join public.lancamentos l on l.id = rc.lancamento_id
          left join public.perfis p on p.id = rc.lancado_por
         where rc.empresa_id = p_empresa_id and rc.data between p_de and p_ate
      ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.hotel_movimento(p_empresa_id uuid, p_de timestamptz, p_ate timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > interval '8 days' then
    raise exception 'Período inválido.';
  end if;
  return coalesce((
    select jsonb_agg(ev order by ev ->> 'quando')
      from (
        -- Reservas feitas
        select jsonb_build_object('quando', r.created_at, 'tipo', 'reserva', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'detalhe', to_char(r.entrada, 'DD/MM') || ' a ' || to_char(r.saida, 'DD/MM'),
                                  'valor', r.valor_previsto, 'quem', p.nome) as ev
          from public.hotel_reservas r
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = r.criado_por
         where r.empresa_id = p_empresa_id and r.created_at between p_de and p_ate
        union all
        select jsonb_build_object('quando', r.checkin_em, 'tipo', 'checkin', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'detalhe', 'saída prevista ' || to_char(r.saida, 'DD/MM'), 'quem', p.nome)
          from public.hotel_reservas r
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = r.checkin_por
         where r.empresa_id = p_empresa_id and r.checkin_em between p_de and p_ate
        union all
        select jsonb_build_object('quando', r.checkout_em, 'tipo', 'checkout', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'detalhe', 'conta fechada',
                                  'valor', (select coalesce(sum(i.total), 0) from public.hotel_conta_itens i where i.reserva_id = r.id and i.cancelado_em is null),
                                  'quem', p.nome)
          from public.hotel_reservas r
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = r.checkout_por
         where r.empresa_id = p_empresa_id and r.checkout_em between p_de and p_ate
        union all
        select jsonb_build_object('quando', r.cancelada_em, 'tipo', case when r.status = 'no_show' then 'no_show' else 'cancelamento' end,
                                  'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero, 'hospede', h.nome,
                                  'detalhe', r.motivo_cancelamento, 'quem', p.nome)
          from public.hotel_reservas r
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = r.cancelada_por
         where r.empresa_id = p_empresa_id and r.cancelada_em between p_de and p_ate
        union all
        -- Pagamentos recebidos e estornados
        select jsonb_build_object('quando', pg.created_at, 'tipo', 'pagamento', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'forma', pg.forma, 'detalhe', case when pg.adiantamento then 'sinal' end,
                                  'valor', pg.valor, 'sessao_id', pg.sessao_id, 'quem', p.nome)
          from public.hotel_pagamentos pg
          join public.hotel_reservas r on r.id = pg.reserva_id
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = pg.recebido_por
         where pg.empresa_id = p_empresa_id and pg.created_at between p_de and p_ate
        union all
        select jsonb_build_object('quando', pg.cancelado_em, 'tipo', 'estorno', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'forma', pg.forma, 'detalhe', pg.motivo_cancelamento, 'valor', pg.valor, 'quem', p.nome)
          from public.hotel_pagamentos pg
          join public.hotel_reservas r on r.id = pg.reserva_id
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = pg.cancelado_por
         where pg.empresa_id = p_empresa_id and pg.cancelado_em between p_de and p_ate
        union all
        -- Consumo, serviços (extras e avulsos) e descontos lançados na conta (as diárias entram no check-out)
        select jsonb_build_object('quando', i.created_at, 'tipo', i.tipo, 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome,
                                  'detalhe', i.descricao || case when i.quantidade <> 1 then ' × ' || trim(to_char(i.quantidade, 'FM999G990D###')) else '' end,
                                  'valor', i.total, 'quem', p.nome)
          from public.hotel_conta_itens i
          join public.hotel_reservas r on r.id = i.reserva_id
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = i.lancado_por
         where i.empresa_id = p_empresa_id and i.tipo in ('consumo', 'servico', 'desconto') and i.created_at between p_de and p_ate
        union all
        select jsonb_build_object('quando', i.cancelado_em, 'tipo', 'item_cancelado', 'reserva_id', r.id, 'reserva_numero', r.numero, 'quarto', q.numero,
                                  'hospede', h.nome, 'detalhe', i.descricao || coalesce(' — ' || i.motivo_cancelamento, ''), 'valor', i.total, 'quem', p.nome)
          from public.hotel_conta_itens i
          join public.hotel_reservas r on r.id = i.reserva_id
          join public.hotel_quartos q on q.id = r.quarto_id join public.hotel_hospedes h on h.id = r.hospede_id
          left join public.perfis p on p.id = i.cancelado_por
         where i.empresa_id = p_empresa_id and i.cancelado_em between p_de and p_ate
        union all
        -- Serviços extras para empresas (recibo)
        select jsonb_build_object('quando', rc.created_at, 'tipo', 'recibo', 'recibo_id', rc.id, 'recibo_numero', rc.numero, 'empresa', c.nome,
                                  'detalhe', (select string_agg(it.descricao || ' × ' || trim(to_char(it.quantidade, 'FM999G990D###')), ', ' order by it.total desc)
                                                from public.hotel_extras_recibo_itens it where it.recibo_id = rc.id)
                                             || case when rc.pagamento = 'a_prazo' then ' (a prazo, vence ' || to_char(rc.vencimento, 'DD/MM') || ')' else '' end,
                                  'forma', rc.forma, 'valor', rc.total, 'sessao_id', rc.sessao_id, 'quem', p.nome)
          from public.hotel_extras_recibos rc
          join public.contrapartes c on c.id = rc.contraparte_id
          left join public.perfis p on p.id = rc.lancado_por
         where rc.empresa_id = p_empresa_id and rc.created_at between p_de and p_ate
        union all
        select jsonb_build_object('quando', rc.cancelado_em, 'tipo', 'recibo_cancelado', 'recibo_id', rc.id, 'recibo_numero', rc.numero, 'empresa', c.nome,
                                  'detalhe', rc.motivo_cancelamento, 'forma', rc.forma, 'valor', rc.total, 'quem', p.nome)
          from public.hotel_extras_recibos rc
          join public.contrapartes c on c.id = rc.contraparte_id
          left join public.perfis p on p.id = rc.cancelado_por
         where rc.empresa_id = p_empresa_id and rc.cancelado_em between p_de and p_ate
      ) t
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.hotel_extras_periodo(uuid, date, date), public.hotel_movimento(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.hotel_extras_periodo(uuid, date, date), public.hotel_movimento(uuid, timestamptz, timestamptz) to authenticated;
