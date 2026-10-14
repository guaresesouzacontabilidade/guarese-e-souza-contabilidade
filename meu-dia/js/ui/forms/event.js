// Compromissos e tarefas: formulário rápido e detalhes.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, formatLongDate, relativeDay, isValidISODate } from '../../core/dates.js';
import { REPEAT_OPTIONS, repeatLabel, isRecurring } from '../../core/recurrence.js';
import { AGENDA_CATEGORIES, findAgendaCategory } from '../../core/categories.js';
import { PRIORITIES, EVENT_REMINDERS, reminderLabel, KIND_LABEL, isDoneOn } from '../../core/agenda.js';
import {
  Button, TextInput, TextArea, DateField, Field, Chips, Segmented, Select, Details, SheetHeader, SheetActions, Icon, Hint,
} from '../components.js';
import { openSheet, replaceSheet, closeLayer, confirm, choose, toast } from '../state.js';

export function EventForm({ kind: initialKind = 'event', item = null, date, onClose }) {
  const settings = store.getState().settings;
  const editing = Boolean(item);
  const [kind, setKind] = useState(item?.kind || initialKind);
  const [title, setTitle] = useState(item?.title || '');
  const [day, setDay] = useState(item?.date || date || todayISO());
  const [time, setTime] = useState(item?.time || '');
  const [endTime, setEndTime] = useState(item?.endTime || '');
  const [location, setLocation] = useState(item?.location || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [category, setCategory] = useState(item?.category || null);
  const [priority, setPriority] = useState(item?.priority || 'normal');
  const [reminder, setReminder] = useState(item ? item.reminder ?? null : undefined);
  const [repeat, setRepeat] = useState(item?.repeat || 'none');
  const [errors, setErrors] = useState({});

  // Lembrete padrão: compromissos com horário avisam com antecedência; tarefas não.
  const effectiveReminder = reminder !== undefined ? reminder : kind === 'event' && time ? settings.eventReminder ?? 30 : null;

  const save = (e) => {
    e?.preventDefault();
    const errs = {};
    if (!title.trim()) errs.title = 'Dê um nome, por exemplo “Dentista”.';
    if (!isValidISODate(day)) errs.date = 'Escolha uma data.';
    if (endTime && time && endTime < time) errs.endTime = 'O término precisa ser depois do início.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const data = {
      kind,
      title: title.trim(),
      date: day,
      time: time || null,
      endTime: kind === 'event' && time ? endTime || null : null,
      location: location.trim(),
      notes: notes.trim(),
      category,
      priority,
      reminder: effectiveReminder,
      repeat,
    };
    if (editing) {
      store.update('events', item.id, data);
      toast(`${KIND_LABEL[kind]} atualizado${kind === 'task' ? 'a' : ''}`, { tone: 'success' });
    } else {
      store.create('events', { ...data, done: false, doneDates: [], skipDates: [] });
      toast(`${KIND_LABEL[kind]} salv${kind === 'task' ? 'a' : 'o'} para ${relativeDay(day, todayISO())}`, { tone: 'success' });
    }
    onClose();
  };

  return html`<form class="form" onSubmit=${save} novalidate>
    <${SheetHeader} title=${editing ? `Editar ${KIND_LABEL[kind].toLowerCase()}` : kind === 'event' ? 'Novo compromisso' : 'Nova tarefa'} onClose=${onClose} />
    <${Segmented}
      label="Tipo"
      value=${kind}
      onChange=${setKind}
      options=${[
        { id: 'event', label: 'Compromisso', icon: 'calendar-clock' },
        { id: 'task', label: 'Tarefa', icon: 'list-checks' },
      ]}
    />
    <${TextInput}
      label=${kind === 'event' ? 'O que é?' : 'O que precisa fazer?'}
      placeholder=${kind === 'event' ? 'Ex.: Dentista, reunião, aniversário' : 'Ex.: Ligar para o banco'}
      value=${title}
      onInput=${setTitle}
      error=${errors.title}
      autofocus=${!editing}
      enterkeyhint="done"
      maxlength="120"
    />
    <${DateField} value=${day} onChange=${setDay} error=${errors.date} />
    ${kind === 'event' &&
    html`<${Field} label="Horário (opcional)" id="ev-time">
      <input id="ev-time" type="time" class="input" value=${time} onInput=${(e) => setTime(e.currentTarget.value)} />
    </${Field}>`}

    <${Details} summary="Mais detalhes (opcional)" open=${editing && Boolean(item.location || item.notes || item.category || isRecurring(item))}>
      ${kind === 'task' &&
      html`<${Field} label="Horário" id="ev-time-t">
        <input id="ev-time-t" type="time" class="input" value=${time} onInput=${(e) => setTime(e.currentTarget.value)} />
      </${Field}>`}
      ${kind === 'event' &&
      time &&
      html`<${Field} label="Término" id="ev-end" error=${errors.endTime}>
        <input id="ev-end" type="time" class="input" value=${endTime} onInput=${(e) => setEndTime(e.currentTarget.value)} />
      </${Field}>`}
      ${kind === 'event' && html`<${TextInput} label="Local" placeholder="Ex.: Clínica Sorriso" value=${location} onInput=${setLocation} maxlength="120" />`}
      <${Field} label="Repetir">
        <${Chips} label="Repetir" options=${REPEAT_OPTIONS} value=${repeat} onChange=${(v) => setRepeat(v || 'none')} />
      </${Field}>
      <${Select}
        label="Lembrete"
        value=${effectiveReminder === null ? '' : String(effectiveReminder)}
        onChange=${(v) => setReminder(v === '' ? null : Number(v))}
        options=${EVENT_REMINDERS.map((r) => ({ id: r.id === null ? '' : String(r.id), label: r.label }))}
        hint=${!time && effectiveReminder !== null ? `Sem horário, o aviso usa o horário padrão (${settings.reminderTime}).` : undefined}
      />
      <${Field} label="Categoria">
        <${Chips} label="Categoria" options=${AGENDA_CATEGORIES} value=${category} onChange=${setCategory} />
      </${Field}>
      <${Field} label="Prioridade">
        <${Segmented} label="Prioridade" options=${PRIORITIES} value=${priority} onChange=${setPriority} />
      </${Field}>
      <${TextArea} label="Notas" value=${notes} onInput=${setNotes} placeholder="Algo para lembrar" maxlength="1000" />
    </${Details}>

    <${SheetActions}>
      <${Button} type="submit" size="lg" icon="check">${editing ? 'Salvar alterações' : 'Salvar'}</${Button}>
    </${SheetActions}>
  </form>`;
}

export function openEventForm(opts = {}) {
  const render = (close) => html`<${EventForm} ...${opts} onClose=${close} />`;
  return opts.replace ? replaceSheet(render) : openSheet(render);
}

export async function deleteEvent(item, date) {
  if (isRecurring(item)) {
    const choice = await choose({
      title: `Excluir “${item.title}”`,
      message: 'Este item se repete. O que deseja excluir?',
      icon: 'repeat',
      danger: true,
      options: [
        { value: 'one', label: `Só ${relativeDay(date, todayISO()) === 'hoje' ? 'hoje' : 'este dia'}`, variant: 'secondary' },
        { value: 'all', label: 'Todas as repetições', variant: 'danger' },
        { value: null, label: 'Cancelar', variant: 'ghost' },
      ],
    });
    if (!choice) return false;
    if (choice === 'one') {
      store.skipOccurrence(item, date);
      toast('Removido deste dia', {
        action: { label: 'Desfazer', onClick: () => store.update('events', item.id, { skipDates: (item.skipDates || []).filter((d) => d !== date) }) },
      });
      return true;
    }
  } else {
    const ok = await confirm({ title: `Excluir “${item.title}”?`, message: 'Você pode desfazer logo em seguida.', confirmLabel: 'Excluir', danger: true });
    if (!ok) return false;
  }
  store.remove('events', item.id);
  toast(`${KIND_LABEL[item.kind]} excluíd${item.kind === 'task' ? 'a' : 'o'}`, { action: { label: 'Desfazer', onClick: () => store.restore('events', item.id) } });
  return true;
}

function EventDetail({ id, date, onClose }) {
  const item = store.findById('events', id);
  if (!item) {
    return html`<div><${SheetHeader} title="Item não encontrado" onClose=${onClose} /><p>Ele pode ter sido excluído.</p></div>`;
  }
  const done = isDoneOn(item, date);
  const cat = findAgendaCategory(item.category);
  const rows = [
    { icon: 'calendar', text: `${formatLongDate(date)}${item.time ? ` · ${item.time}${item.endTime ? `–${item.endTime}` : ''}` : ''}` },
    item.location && { icon: 'map-pin', text: item.location },
    isRecurring(item) && { icon: 'repeat', text: repeatLabel(item.repeat) },
    item.reminder !== null && item.reminder !== undefined && { icon: 'bell', text: `Lembrete: ${reminderLabel(item.reminder).toLowerCase()}` },
    cat && { icon: cat.icon, text: cat.label },
    item.priority === 'high' && { icon: 'flag', text: 'Prioridade alta' },
  ].filter(Boolean);

  return html`<div class="form">
    <${SheetHeader} title=${item.title} subtitle=${item.kind === 'task' ? (done ? 'Tarefa concluída' : 'Tarefa') : 'Compromisso'} onClose=${onClose} />
    <ul class="sentences">
      ${rows.map((r) => html`<li key=${r.text}><${Icon} name=${r.icon} size=${18} /><span>${r.text}</span></li>`)}
    </ul>
    ${item.notes && html`<p class="hint"><${Icon} name="notebook-pen" size=${16} /><span>${item.notes}</span></p>`}
    ${item.kind === 'task' &&
    html`<${Button}
      size="lg"
      variant=${done ? 'secondary' : 'primary'}
      icon=${done ? 'rotate-ccw' : 'circle-check'}
      onClick=${() => {
        store.toggleTask(item, date);
        toast(done ? 'Tarefa reaberta' : 'Tarefa concluída', { tone: 'success' });
        onClose();
      }}
    >
      ${done ? 'Marcar como não feita' : 'Concluir tarefa'}
    </${Button}>`}
    <div class="row-actions">
      <${Button} variant="secondary" icon="pencil" onClick=${() => openEventForm({ item, replace: true })}>Editar</${Button}>
      <${Button}
        variant="danger-ghost"
        icon="trash-2"
        onClick=${async () => {
          if (await deleteEvent(item, date)) closeLayer();
        }}
      >
        Excluir
      </${Button}>
    </div>
    ${isRecurring(item) && html`<${Hint}>Editar muda todas as repetições. Para tirar só um dia, use Excluir › Só este dia.</${Hint}>`}
  </div>`;
}

export function openEventDetail(item, date) {
  return openSheet((close) => html`<${EventDetail} id=${item.id} date=${date} onClose=${close} />`);
}
