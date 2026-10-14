// Calcula quando cada lembrete deve aparecer. O agendamento em si fica em services/notifications.js.
import { addDays, toTimestamp, todayISO, formatShort } from './dates.js';
import { occurrencesInRange } from './agenda.js';
import { formatMoney } from './money.js';

// Lembretes que disparam entre `fromMs` e `toMs`.
export function dueReminders({ events, bills, settings }, fromMs, toMs) {
  const out = [];
  const defaultTime = settings?.reminderTime || '09:00';
  const fromDay = addDays(todayISO(new Date(fromMs)), -1);
  const toDay = addDays(todayISO(new Date(toMs)), 8);

  for (const occ of occurrencesInRange(events, fromDay, toDay)) {
    const { item, date } = occ;
    if (item.reminder === null || item.reminder === undefined || occ.done) continue;
    const base = toTimestamp(date, item.time || defaultTime);
    const fireAt = base - item.reminder * 60000;
    if (fireAt <= fromMs || fireAt > toMs) continue;
    const when = item.time ? `às ${item.time}` : 'hoje';
    out.push({
      // O horário entra na chave: se o compromisso mudar de hora, avisa de novo.
      key: `ev:${item.id}:${fireAt}`,
      fireAt,
      title: item.kind === 'task' ? `Tarefa: ${item.title}` : item.title,
      body: item.reminder >= 1440 ? `Amanhã ${item.time ? `às ${item.time}` : ''}`.trim() : `${item.location ? `${item.location} · ` : ''}${when}`,
      route: `#/agenda?dia=${date}`,
      kind: item.kind === 'task' ? 'task' : 'event',
      ref: { id: item.id, date },
    });
  }

  for (const bill of bills) {
    if (bill.deleted || bill.status === 'paid') continue;
    for (const daysBefore of bill.remind || []) {
      const day = addDays(bill.dueDate, -daysBefore);
      const fireAt = toTimestamp(day, defaultTime);
      if (fireAt <= fromMs || fireAt > toMs) continue;
      const verb = bill.kind === 'receive' ? 'a receber' : 'a pagar';
      const when = daysBefore === 0 ? 'vence hoje' : daysBefore === 1 ? 'vence amanhã' : `vence em ${daysBefore} dias (${formatShort(bill.dueDate)})`;
      out.push({
        key: `bill:${bill.id}:${fireAt}`,
        fireAt,
        title: `${bill.description} ${when}`,
        body: `${formatMoney(bill.amount)} ${verb}`,
        route: '#/contas',
        kind: bill.kind === 'receive' ? 'bill-receive' : 'bill',
        ref: { id: bill.id },
      });
    }
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}
