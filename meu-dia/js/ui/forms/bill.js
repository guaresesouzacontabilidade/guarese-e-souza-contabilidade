// Contas a pagar e a receber: cadastro, detalhes e "pagar com um toque".
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, formatLongDate, formatNumeric, dueLabel, isValidISODate, formatShort } from '../../core/dates.js';
import { formatMoney } from '../../core/money.js';
import { REPEAT_OPTIONS, repeatLabel, isRecurring } from '../../core/recurrence.js';
import { categoriesFor, findCategory } from '../../core/categories.js';
import { BILL_KIND, BILL_REMIND_OPTIONS, billState } from '../../core/bills.js';
import { findPossibleDuplicates, walletType, live } from '../../core/finance.js';
import { parseBoleto } from '../../core/boleto.js';
import { scanBoleto, scannerAvailable, copyText } from '../../services/scanner.js';
import {
  Button, TextInput, TextArea, DateField, Field, Chips, Segmented, MoneyInput, Details, SheetHeader, SheetActions, Icon, Money, Hint,
} from '../components.js';
import { openSheet, replaceSheet, closeLayer, confirm, toast } from '../state.js';
import { feedback } from '../../services/feedback.js';
import { celebrate } from '../fx.js';

export function BillForm({ kind: initialKind = 'pay', item = null, onClose }) {
  const s = store.getState();
  const custom = s.settings.customCategories || [];
  const editing = Boolean(item);
  const [kind, setKind] = useState(item?.kind || initialKind);
  const [description, setDescription] = useState(item?.description || '');
  const [amount, setAmount] = useState(item?.amount || 0);
  const [dueDate, setDueDate] = useState(item?.dueDate || todayISO());
  const [repeat, setRepeat] = useState(item?.repeat || 'none');
  const [remind, setRemind] = useState(item?.remind ?? s.settings.billRemind ?? [1, 0]);
  const [category, setCategory] = useState(item?.category || null);
  const [walletId, setWalletId] = useState(item?.walletId || null);
  const [notes, setNotes] = useState(item?.notes || '');
  const [barcode, setBarcode] = useState(item?.barcode || '');
  const [pasting, setPasting] = useState(false);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState({});
  const wallets = live(s.wallets);
  const txType = BILL_KIND[kind].tx;

  // Preenche a conta a partir do código do boleto (lido pela câmera ou colado).
  const applyBoleto = (raw) => {
    const b = parseBoleto(raw, todayISO());
    if (!b) {
      toast('Não reconheci esse código. Confira se é a linha digitável do boleto.', { tone: 'warning' });
      return false;
    }
    if (b.amount) setAmount(b.amount);
    if (b.dueDate) setDueDate(b.dueDate);
    if (!description.trim()) setDescription(b.suggestion.description);
    if (!category && b.suggestion.category) setCategory(b.suggestion.category);
    setBarcode(b.line);
    setKind('pay');
    feedback('success');
    const parts = [b.amount ? formatMoney(b.amount) : null, b.dueDate ? `vence ${formatNumeric(b.dueDate).slice(0, 5)}` : 'informe o vencimento'].filter(Boolean);
    toast(b.valid ? `Boleto lido: ${parts.join(', ')}` : `Código lido, mas pode ter erro — confira os dados (${parts.join(', ')}).`, { tone: b.valid ? 'success' : 'warning' });
    return true;
  };
  const scan = async () => {
    try {
      const raw = await scanBoleto();
      if (raw) applyBoleto(raw);
    } catch (err) {
      toast(err.message || 'Não foi possível abrir a câmera.', { tone: 'warning' });
    }
  };

  const save = (e) => {
    e?.preventDefault();
    const errs = {};
    if (!description.trim()) errs.description = kind === 'pay' ? 'Diga qual é a conta, ex.: “Luz”.' : 'Diga o que vai receber, ex.: “Aluguel do apartamento”.';
    if (!amount || amount <= 0) errs.amount = 'Digite o valor.';
    if (!isValidISODate(dueDate)) errs.dueDate = 'Escolha a data de vencimento.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const data = {
      kind,
      description: description.trim(),
      amount,
      dueDate,
      repeat,
      remind: [...remind].sort((a, b) => b - a),
      category,
      walletId,
      notes: notes.trim(),
      barcode: barcode || null,
    };
    if (editing) {
      // Mudou o vencimento de uma conta recorrente: a série passa a seguir a nova data.
      const patch = item.dueDate !== dueDate ? { ...data, seriesStart: dueDate } : data;
      store.update('bills', item.id, patch);
      feedback('save');
      toast('Conta atualizada', { tone: 'success' });
    } else {
      store.create('bills', { ...data, status: 'open', seriesStart: dueDate });
      feedback('save');
      toast(`Conta salva · ${dueLabel(dueDate, todayISO())}`, { tone: 'success' });
    }
    onClose();
  };

  return html`<form class="form" onSubmit=${save} novalidate>
    <${SheetHeader} title=${editing ? 'Editar conta' : 'Nova conta'} subtitle=${editing ? '' : 'Para lembrar antes do vencimento'} onClose=${onClose} />
    <${Segmented}
      label="Tipo de conta"
      value=${kind}
      onChange=${setKind}
      options=${[
        { id: 'pay', label: 'A pagar', icon: 'receipt' },
        { id: 'receive', label: 'A receber', icon: 'hand-coins' },
      ]}
    />
    ${kind === 'pay' &&
    !editing &&
    html`<div class="row-actions">
      ${scannerAvailable() && html`<${Button} variant="secondary" icon="scan-barcode" onClick=${scan}>Ler código de barras</${Button}>`}
      <${Button} variant="secondary" icon="copy" onClick=${() => setPasting(!pasting)}>${pasting ? 'Fechar' : 'Colar código do boleto'}</${Button}>
    </div>`}
    ${pasting &&
    html`<${TextInput}
      label="Linha digitável ou código de barras"
      inputmode="numeric"
      placeholder="Cole ou digite os números do boleto"
      value=${code}
      onInput=${(v) => {
        setCode(v);
        const digits = v.replace(/\D/g, '');
        if ([44, 47, 48].includes(digits.length) && applyBoleto(digits)) setPasting(false);
      }}
      hint="Valor e vencimento são preenchidos sozinhos."
    />`}
    ${barcode && html`<${Hint} icon="scan-barcode">Código do boleto guardado — dá para copiar depois na conta, para pagar no app do banco.</${Hint}>`}
    <${TextInput}
      label="Descrição"
      placeholder=${kind === 'pay' ? 'Ex.: Luz, aluguel, cartão' : 'Ex.: Cliente, aluguel recebido'}
      value=${description}
      onInput=${setDescription}
      error=${errors.description}
      autofocus=${!editing}
      maxlength="120"
    />
    <${MoneyInput} value=${amount} onChange=${setAmount} error=${errors.amount} />
    <${DateField} label="Vencimento" value=${dueDate} onChange=${setDueDate} error=${errors.dueDate} />
    <${Field} label="Repetir">
      <${Chips} label="Repetir" options=${REPEAT_OPTIONS} value=${repeat} onChange=${(v) => setRepeat(v || 'none')} />
    </${Field}>
    <${Field} label="Lembrar" hint=${remind.length ? `Aviso às ${s.settings.reminderTime} nos dias escolhidos.` : 'Sem lembrete para esta conta.'}>
      <${Chips} label="Lembrar" multiple options=${BILL_REMIND_OPTIONS} value=${remind} onChange=${setRemind} />
    </${Field}>
    <${Details} summary="Mais detalhes (opcional)" open=${editing && Boolean(item.category || item.notes || item.walletId)}>
      <${Field} label="Categoria">
        <${Chips} label="Categoria" options=${categoriesFor(txType, custom)} value=${category} onChange=${setCategory} />
      </${Field}>
      ${wallets.length > 0 &&
      html`<${Field} label="Carteira usada">
        <${Chips} label="Carteira" options=${wallets.map((w) => ({ id: w.id, label: w.name, icon: walletType(w.type).icon }))} value=${walletId} onChange=${setWalletId} />
      </${Field}>`}
      <${TextArea} label="Observações" value=${notes} onInput=${setNotes} placeholder="Ex.: código de barras, contrato" maxlength="1000" />
    </${Details}>
    <${SheetActions}>
      <${Button} type="submit" size="lg" icon="check">${editing ? 'Salvar alterações' : 'Salvar conta'}</${Button}>
    </${SheetActions}>
  </form>`;
}

export function openBillForm(opts = {}) {
  const render = (close) => html`<${BillForm} ...${opts} onClose=${close} />`;
  return opts.replace ? replaceSheet(render) : openSheet(render);
}

// ---------- Pagar / receber com um toque ----------

// Marca na hora e depois pergunta se quer registrar em Finanças (sem duplicar).
export function quickPay(bill, { replace = false } = {}) {
  const today = todayISO();
  const { bill: paid, next } = store.payBill(bill, { date: today, amount: bill.amount });
  feedback('success');
  celebrate();
  const kind = BILL_KIND[bill.kind];
  const existing = store.linkedTransaction(paid);
  if (existing) {
    toast(`${bill.description}: ${kind.done.toLowerCase()} · já estava em Finanças`, {
      tone: 'success',
      action: { label: 'Desfazer', onClick: () => store.unpayBill(store.findById('bills', bill.id)) },
    });
    return;
  }
  const render = (close) => html`<${AfterPay} billId=${bill.id} nextId=${next?.id} onClose=${close} />`;
  if (replace) replaceSheet(render);
  else openSheet(render);
}

function AfterPay({ billId, nextId, onClose }) {
  const s = store.getState();
  const bill = store.findById('bills', billId);
  const next = nextId ? store.findById('bills', nextId) : null;
  const txType = BILL_KIND[bill?.kind || 'pay'].tx;
  const [walletId, setWalletId] = useState(bill?.walletId || null);
  const [amount, setAmount] = useState(bill?.paidAmount ?? bill?.amount ?? 0);
  const [date, setDate] = useState(bill?.paidAt || todayISO());
  const linkedIds = new Set(s.bills.filter((b) => !b.deleted && b.transactionId).map((b) => b.transactionId));
  const dup = bill
    ? findPossibleDuplicates(s.transactions, { type: txType, amount, date, description: bill.description, unlinkedOnly: true, linkedIds })[0]
    : null;
  const [choice, setChoice] = useState(dup ? 'link' : 'new');
  if (!bill) return html`<div><${SheetHeader} title="Conta não encontrada" onClose=${onClose} /></div>`;
  const kind = BILL_KIND[bill.kind];
  const wallets = live(s.wallets);

  const applyEdits = () => {
    if (amount !== bill.paidAmount || date !== bill.paidAt) store.update('bills', bill.id, { paidAmount: amount, paidAt: date });
    return store.findById('bills', bill.id);
  };

  const register = () => {
    const b = applyEdits();
    if (choice === 'link' && dup) {
      store.linkBillTransaction(b, dup.id);
      toast(`Vinculada ao lançamento de ${formatNumeric(dup.date)}. Nada foi duplicado.`, { tone: 'success' });
    } else {
      store.registerBillTransaction(b, { walletId });
      toast(`${txType === 'expense' ? 'Despesa' : 'Receita'} de ${formatMoney(b.paidAmount)} registrada em Finanças`, { tone: 'success' });
    }
    onClose();
  };
  const skip = () => {
    applyEdits();
    toast(`${bill.description}: ${kind.done.toLowerCase()}`, { tone: 'success' });
    onClose();
  };
  const undo = () => {
    store.unpayBill(store.findById('bills', bill.id));
    toast('Pagamento desfeito');
    onClose();
  };

  return html`<div class="form">
    <${SheetHeader}
      title=${`${bill.description} marcada como ${kind.done.toLowerCase()}`}
      subtitle=${next ? `Próxima já agendada para ${formatShort(next.dueDate)}.` : ''}
      onClose=${skip}
    />
    <div class="hint" style=${{ fontSize: '15.5px', color: 'var(--text)' }}>
      <${Icon} name="circle-check" size=${20} />
      <span>Deseja registrar ${txType === 'expense' ? 'esta despesa' : 'esta receita'} em Finanças? Assim seu saldo do mês fica certo.</span>
    </div>
    ${dup &&
    html`<${Field} label="Encontramos um lançamento parecido">
      <div class="chips" role="radiogroup" aria-label="O que fazer">
        <button type="button" role="radio" aria-checked=${choice === 'link' ? 'true' : 'false'} class=${`chip ${choice === 'link' ? 'is-active' : ''}`} onClick=${() => setChoice('link')}>
          <${Icon} name="check" size=${16} />Usar “${dup.description}” de ${formatNumeric(dup.date).slice(0, 5)}
        </button>
        <button type="button" role="radio" aria-checked=${choice === 'new' ? 'true' : 'false'} class=${`chip ${choice === 'new' ? 'is-active' : ''}`} onClick=${() => setChoice('new')}>
          <${Icon} name="plus" size=${16} />Criar novo
        </button>
      </div>
      <p class="field-hint">Usar o existente evita contar o mesmo valor duas vezes.</p>
    </${Field}>`}
    ${choice === 'new' &&
    wallets.length > 0 &&
    html`<${Field} label="Carteira (opcional)">
      <${Chips} label="Carteira" options=${wallets.map((w) => ({ id: w.id, label: w.name, icon: walletType(w.type).icon }))} value=${walletId} onChange=${setWalletId} />
    </${Field}>`}
    <${Details} summary="Valor ou data diferentes?">
      <${MoneyInput} label=${bill.kind === 'pay' ? 'Valor pago' : 'Valor recebido'} value=${amount} onChange=${setAmount} />
      <${DateField} label=${bill.kind === 'pay' ? 'Pago em' : 'Recebido em'} value=${date} onChange=${setDate} past />
    </${Details}>
    <div class="dialog-actions" style=${{ marginTop: 0 }}>
      <${Button} size="lg" icon="check" onClick=${register} data-autofocus>
        ${choice === 'link' && dup ? 'Usar lançamento existente' : `Registrar ${txType === 'expense' ? 'despesa' : 'receita'}`}
      </${Button}>
      <${Button} size="lg" variant="secondary" onClick=${skip}>Agora não</${Button}>
      <${Button} variant="ghost" icon="rotate-ccw" onClick=${undo}>Desfazer pagamento</${Button}>
    </div>
  </div>`;
}

export async function deleteBill(bill) {
  const ok = await confirm({
    title: `Excluir “${bill.description}”?`,
    message: isRecurring(bill) ? 'Só esta conta será excluída. As próximas não serão mais criadas a partir dela.' : 'Você pode desfazer logo em seguida.',
    confirmLabel: 'Excluir',
    danger: true,
  });
  if (!ok) return false;
  store.remove('bills', bill.id);
  feedback('delete');
  toast('Conta excluída', { action: { label: 'Desfazer', onClick: () => store.restore('bills', bill.id) } });
  return true;
}

export async function undoPayment(bill) {
  const tx = store.linkedTransaction(bill);
  store.unpayBill(bill);
  if (tx) {
    const remove = await confirm({
      title: 'Remover também de Finanças?',
      message: `Existe ${tx.type === 'expense' ? 'uma despesa' : 'uma receita'} de ${formatMoney(tx.amount)} registrada para esta conta.`,
      confirmLabel: 'Remover lançamento',
      cancelLabel: 'Manter lançamento',
      icon: 'circle-help',
    });
    if (remove) store.remove('transactions', tx.id);
    store.update('bills', bill.id, { transactionId: remove ? null : tx.id });
  }
  toast('Conta reaberta');
}

function BillDetail({ id, onClose }) {
  const s = store.getState();
  const bill = store.findById('bills', id);
  if (!bill) return html`<div><${SheetHeader} title="Conta não encontrada" onClose=${onClose} /></div>`;
  const today = todayISO();
  const state = billState(bill, today);
  const kind = BILL_KIND[bill.kind];
  const cat = bill.category ? findCategory(bill.category, kind.tx, s.settings.customCategories) : null;
  const wallet = s.wallets.find((w) => w.id === bill.walletId && !w.deleted);
  const tx = store.linkedTransaction(bill);
  const statusText = {
    paid: `${kind.done} em ${formatNumeric(bill.paidAt || bill.dueDate)}`,
    overdue: dueLabel(bill.dueDate, today),
    soon: dueLabel(bill.dueDate, today),
    upcoming: dueLabel(bill.dueDate, today),
  }[state];
  const remindText = (bill.remind || []).length
    ? BILL_REMIND_OPTIONS.filter((o) => bill.remind.includes(o.id)).map((o) => o.label.toLowerCase()).join(', ')
    : 'sem lembrete';

  return html`<div class="form">
    <${SheetHeader} title=${bill.description} subtitle=${kind.label} onClose=${onClose} />
    <div class="detail-hero">
      <span class=${`cat-icon tone-${state === 'paid' ? 'ok' : state === 'overdue' ? 'danger' : state === 'soon' ? 'warning' : 'neutral'}`}>
        <${Icon} name=${state === 'paid' ? 'circle-check' : state === 'overdue' ? 'triangle-alert' : 'calendar-clock'} size=${20} />
      </span>
      <div>
        <div class="detail-label">${statusText}</div>
        <div class="detail-value num"><${Money} value=${bill.status === 'paid' ? bill.paidAmount ?? bill.amount : bill.amount} /></div>
      </div>
    </div>
    <ul class="sentences">
      <li><${Icon} name="calendar" size=${18} /><span>Vencimento: ${formatLongDate(bill.dueDate)}</span></li>
      ${isRecurring(bill) && html`<li><${Icon} name="repeat" size=${18} /><span>${repeatLabel(bill.repeat)}</span></li>`}
      <li><${Icon} name="bell" size=${18} /><span>Lembrete: ${remindText}</span></li>
      ${cat && html`<li><${Icon} name=${cat.icon} size=${18} /><span>${cat.label}</span></li>`}
      ${wallet && html`<li><${Icon} name=${walletType(wallet.type).icon} size=${18} /><span>${wallet.name}</span></li>`}
      ${bill.status === 'paid' &&
      html`<li><${Icon} name=${tx ? 'circle-check' : 'info'} size=${18} /><span>${tx ? 'Registrada em Finanças' : 'Não registrada em Finanças'}</span></li>`}
      ${bill.notes && html`<li><${Icon} name="notebook-pen" size=${18} /><span>${bill.notes}</span></li>`}
    </ul>
    ${bill.barcode &&
    bill.status !== 'paid' &&
    html`<${Button}
      variant="secondary"
      icon="copy"
      onClick=${async () => {
        const ok = await copyText(bill.barcode.replace(/\D/g, ''));
        toast(ok ? 'Código copiado. Cole no app do banco para pagar.' : 'Não foi possível copiar.', { tone: ok ? 'success' : 'warning' });
      }}
    >
      Copiar código do boleto
    </${Button}>`}
    ${bill.status !== 'paid'
      ? html`<${Button}
          size="lg"
          icon="circle-check"
          onClick=${() => quickPay(bill, { replace: true })}
        >
          ${kind.doneVerb}
        </${Button}>`
      : html`<div class="row-actions">
          ${!tx &&
          html`<${Button}
            variant="secondary"
            icon="plus"
            onClick=${() => {
              store.registerBillTransaction(bill, {});
              toast('Registrada em Finanças', { tone: 'success' });
            }}
          >
            Registrar em Finanças
          </${Button}>`}
          <${Button}
            variant="secondary"
            icon="rotate-ccw"
            onClick=${async () => {
              await undoPayment(bill);
              closeLayer();
            }}
          >
            Desfazer pagamento
          </${Button}>
        </div>`}
    <div class="row-actions">
      <${Button} variant="secondary" icon="pencil" onClick=${() => openBillForm({ item: bill, replace: true })}>Editar</${Button}>
      <${Button}
        variant="danger-ghost"
        icon="trash-2"
        onClick=${async () => {
          if (await deleteBill(bill)) closeLayer();
        }}
      >
        Excluir
      </${Button}>
    </div>
    ${isRecurring(bill) && bill.status !== 'paid' && html`<${Hint}>Ao marcar como ${bill.kind === 'pay' ? 'paga' : 'recebida'}, a próxima é criada automaticamente.</${Hint}>`}
  </div>`;
}

export function openBillDetail(bill) {
  return openSheet((close) => html`<${BillDetail} id=${bill.id} onClose=${close} />`);
}
