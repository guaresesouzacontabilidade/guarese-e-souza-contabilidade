// Menu "Adicionar": cinco opções simples.
import { html } from '../../vendor/preact.js';
import { Icon, SheetHeader } from '../components.js';
import { openSheet } from '../state.js';
import { openEventForm } from './event.js';
import { openTransactionForm, startVoiceEntry } from './transaction.js';
import { voiceAvailable } from '../../services/voice.js';
import { openBillForm } from './bill.js';
import { openImport } from './import.js';

export const ADD_OPTIONS = [
  { id: 'event', label: 'Compromisso', sub: 'Com data e horário', icon: 'calendar-clock' },
  { id: 'task', label: 'Tarefa', sub: 'Algo para fazer', icon: 'list-checks' },
  { id: 'expense', label: 'Despesa', sub: 'Dinheiro que saiu', icon: 'arrow-up-right' },
  { id: 'income', label: 'Receita', sub: 'Dinheiro que entrou', icon: 'arrow-down-left' },
  { id: 'bill', label: 'Conta', sub: 'A pagar ou a receber, com lembrete', icon: 'receipt' },
  { id: 'voice', label: 'Falar um gasto', sub: 'Ex.: “gastei 45 reais de gasolina”', icon: 'mic', menuOnly: true, needsVoice: true },
  { id: 'import', label: 'Importar extrato ou fatura', sub: 'PDF, OFX ou CSV do banco', icon: 'file-up', menuOnly: true },
];

// Abre direto o formulário do tipo escolhido.
export function openAddForm(id, { date, replace = false } = {}) {
  if (id === 'event' || id === 'task') return openEventForm({ kind: id, date, replace });
  if (id === 'expense' || id === 'income') return openTransactionForm({ type: id, replace });
  if (id === 'bill' || id === 'bill-receive') return openBillForm({ kind: id === 'bill-receive' ? 'receive' : 'pay', replace });
  if (id === 'import') return openImport({ replace });
  if (id === 'voice') return startVoiceEntry({ replace });
  return null;
}

function AddMenu({ onClose, date }) {
  return html`<div>
    <${SheetHeader} title="Adicionar" subtitle="O que você quer registrar?" onClose=${onClose} />
    <div class="add-grid">
      ${ADD_OPTIONS.filter((o) => !o.needsVoice || voiceAvailable()).map(
        (o, i) => html`<button
          type="button"
          key=${o.id}
          class=${`add-opt ${o.id === 'bill' || o.menuOnly ? 'wide' : ''}`}
          style=${{ '--i': i }}
          data-autofocus=${i === 0 ? '' : undefined}
          onClick=${() => openAddForm(o.id, { date, replace: true })}
        >
          <span class="q-ico cat-icon ${o.id === 'income' ? 'tone-income' : o.id === 'expense' ? 'tone-expense' : o.id === 'bill' ? 'tone-warning' : o.menuOnly ? 'tone-ok' : 'tone-event'}">
            <${Icon} name=${o.icon} size=${22} />
          </span>
          <span class="txt">
            <strong>${o.label}</strong>
            <span class="sub">${o.sub}</span>
          </span>
        </button>`,
      )}
    </div>
  </div>`;
}

export function openAddMenu({ date } = {}) {
  return openSheet((close) => html`<${AddMenu} onClose=${close} date=${date} />`);
}
