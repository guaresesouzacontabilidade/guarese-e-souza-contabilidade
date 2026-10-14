// Receitas e despesas: registro rápido, detalhes, edição e exclusão.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, formatLongDate, formatNumeric, isValidISODate } from '../../core/dates.js';
import { formatMoney } from '../../core/money.js';
import { categoriesFor, findCategory, suggestCategory } from '../../core/categories.js';
import { findPossibleDuplicates, walletType, live } from '../../core/finance.js';
import {
  Button, TextInput, TextArea, DateField, Field, Chips, Segmented, MoneyInput, Details, SheetHeader, SheetActions, Icon, Money, CategoryIcon,
} from '../components.js';
import { openSheet, replaceSheet, closeLayer, confirm, toast } from '../state.js';

const TYPE_LABEL = { expense: 'Despesa', income: 'Receita' };
const VISIBLE_CATS = 7;

export function TransactionForm({ type: initialType = 'expense', item = null, date, onClose }) {
  const s = store.getState();
  const custom = s.settings.customCategories || [];
  const editing = Boolean(item);
  const [type, setType] = useState(item?.type || initialType);
  const [amount, setAmount] = useState(item?.amount || 0);
  const [description, setDescription] = useState(item?.description || '');
  const [day, setDay] = useState(item?.date || date || todayISO());
  const [category, setCategory] = useState(item?.category || null);
  const [pickedCategory, setPicked] = useState(Boolean(item?.category));
  const [walletId, setWalletId] = useState(item?.walletId ?? (s.wallets.filter((w) => !w.deleted).length === 1 ? s.wallets.find((w) => !w.deleted).id : null));
  const [notes, setNotes] = useState(item?.notes || '');
  const [showAllCats, setShowAllCats] = useState(false);
  const [errors, setErrors] = useState({});

  const wallets = live(s.wallets);
  const cats = categoriesFor(type, custom);
  // A categoria escolhida/sugerida aparece entre as primeiras.
  let visible = cats;
  if (!showAllCats) {
    visible = cats.slice(0, VISIBLE_CATS);
    const sel = cats.find((c) => c.id === category);
    if (sel && !visible.includes(sel)) visible = [sel, ...visible.slice(0, VISIBLE_CATS - 1)];
  }

  const onDescription = (value) => {
    setDescription(value);
    if (!pickedCategory) setCategory(suggestCategory(value, type, s.transactions, custom));
  };
  const onType = (t) => {
    setType(t);
    if (!pickedCategory || !categoriesFor(t, custom).some((c) => c.id === category)) {
      setPicked(false);
      setCategory(suggestCategory(description, t, s.transactions, custom));
    }
  };

  const save = async (e) => {
    e?.preventDefault();
    const errs = {};
    if (!amount || amount <= 0) errs.amount = 'Digite o valor.';
    if (!description.trim()) errs.description = type === 'expense' ? 'Diga com o que gastou, ex.: “Mercado”.' : 'Diga de onde veio, ex.: “Salário”.';
    if (!isValidISODate(day)) errs.date = 'Escolha uma data.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const data = { type, amount, description: description.trim(), date: day, category, walletId: walletId || null, notes: notes.trim() };
    if (!editing) {
      const dup = findPossibleDuplicates(s.transactions, { type, amount, date: day, description })[0];
      if (dup) {
        const go = await confirm({
          title: 'Parece repetido',
          message: `Você já registrou “${dup.description}” de ${formatMoney(dup.amount)} em ${formatNumeric(dup.date)}. Registrar outro mesmo assim?`,
          confirmLabel: 'Registrar mesmo assim',
          cancelLabel: 'Voltar',
          icon: 'triangle-alert',
        });
        if (!go) return;
      }
      const created = store.create('transactions', data);
      toast(`${TYPE_LABEL[type]} de ${formatMoney(amount)} registrada`, {
        tone: 'success',
        action: { label: 'Desfazer', onClick: () => store.remove('transactions', created.id) },
      });
    } else {
      store.update('transactions', item.id, data);
      toast(`${TYPE_LABEL[type]} atualizada`, { tone: 'success' });
    }
    onClose();
  };

  return html`<form class="form" onSubmit=${save} novalidate>
    <${SheetHeader} title=${editing ? `Editar ${TYPE_LABEL[type].toLowerCase()}` : type === 'expense' ? 'Nova despesa' : 'Nova receita'} onClose=${onClose} />
    <${Segmented}
      label="Tipo de lançamento"
      value=${type}
      onChange=${onType}
      options=${[
        { id: 'expense', label: 'Despesa', icon: 'arrow-up-right' },
        { id: 'income', label: 'Receita', icon: 'arrow-down-left' },
      ]}
    />
    <${MoneyInput} big value=${amount} onChange=${setAmount} error=${errors.amount} autoFocus=${!editing} />
    <${TextInput}
      label="Descrição"
      placeholder=${type === 'expense' ? 'Ex.: Mercado, gasolina, farmácia' : 'Ex.: Salário, venda, freela'}
      value=${description}
      onInput=${onDescription}
      error=${errors.description}
      enterkeyhint="done"
      maxlength="120"
      autocomplete="off"
    />
    <${DateField} value=${day} onChange=${setDay} past error=${errors.date} />
    <${Field} label=${category && !pickedCategory ? 'Categoria (sugerida)' : 'Categoria (opcional)'}>
      <${Chips}
        label="Categoria"
        options=${visible}
        value=${category}
        onChange=${(v) => {
          setCategory(v);
          setPicked(true);
        }}
      />
      ${!showAllCats && cats.length > VISIBLE_CATS && html`<button type="button" class="link-btn" onClick=${() => setShowAllCats(true)}><span>Ver todas as categorias</span><${Icon} name="chevron-down" size=${16} /></button>`}
    </${Field}>
    ${wallets.length > 0 &&
    html`<${Field} label="Carteira (opcional)">
      <${Chips}
        label="Carteira"
        options=${wallets.map((w) => ({ id: w.id, label: w.name, icon: walletType(w.type).icon }))}
        value=${walletId}
        onChange=${setWalletId}
      />
    </${Field}>`}
    <${Details} summary="Observações (opcional)" open=${Boolean(item?.notes)}>
      <${TextArea} label="Observações" value=${notes} onInput=${setNotes} placeholder="Algum detalhe para lembrar" maxlength="1000" />
    </${Details}>
    <${SheetActions}>
      <${Button} type="submit" size="lg" icon="check">${editing ? 'Salvar alterações' : `Registrar ${TYPE_LABEL[type].toLowerCase()}`}</${Button}>
    </${SheetActions}>
  </form>`;
}

export function openTransactionForm(opts = {}) {
  const render = (close) => html`<${TransactionForm} ...${opts} onClose=${close} />`;
  return opts.replace ? replaceSheet(render) : openSheet(render);
}

export async function deleteTransaction(item) {
  const ok = await confirm({
    title: `Excluir “${item.description}”?`,
    message: `${TYPE_LABEL[item.type]} de ${formatMoney(item.amount)} em ${formatNumeric(item.date)}. Os totais serão recalculados.`,
    confirmLabel: 'Excluir',
    danger: true,
  });
  if (!ok) return false;
  store.remove('transactions', item.id);
  // Se veio de uma conta paga, desfaz o vínculo para não confundir.
  const bill = store.getState().bills.find((b) => !b.deleted && b.transactionId === item.id);
  if (bill) store.update('bills', bill.id, { transactionId: null });
  toast('Lançamento excluído', {
    action: {
      label: 'Desfazer',
      onClick: () => {
        store.restore('transactions', item.id);
        if (bill) store.update('bills', bill.id, { transactionId: item.id });
      },
    },
  });
  return true;
}

function TransactionDetail({ id, onClose }) {
  const s = store.getState();
  const item = store.findById('transactions', id);
  if (!item) return html`<div><${SheetHeader} title="Lançamento não encontrado" onClose=${onClose} /></div>`;
  const cat = findCategory(item.category, item.type, s.settings.customCategories);
  const wallet = s.wallets.find((w) => w.id === item.walletId && !w.deleted);
  const bill = item.billId ? s.bills.find((b) => b.id === item.billId && !b.deleted) : null;
  return html`<div class="form">
    <${SheetHeader} title=${item.description} subtitle=${TYPE_LABEL[item.type]} onClose=${onClose} />
    <div class="detail-hero">
      <${CategoryIcon} icon=${cat.icon} tone=${item.type} />
      <div>
        <div class="detail-label">${cat.label}</div>
        <div class="detail-value num">
          <${Money} value=${item.type === 'income' ? item.amount : -item.amount} signed />
        </div>
      </div>
    </div>
    <ul class="sentences">
      <li><${Icon} name="calendar" size=${18} /><span>${formatLongDate(item.date)} de ${item.date.slice(0, 4)}</span></li>
      ${wallet && html`<li><${Icon} name=${walletType(wallet.type).icon} size=${18} /><span>${wallet.name}</span></li>`}
      ${bill && html`<li><${Icon} name="receipt" size=${18} /><span>Registrado ao marcar a conta “${bill.description}” como ${bill.kind === 'receive' ? 'recebida' : 'paga'}</span></li>`}
      ${item.notes && html`<li><${Icon} name="notebook-pen" size=${18} /><span>${item.notes}</span></li>`}
    </ul>
    <div class="row-actions">
      <${Button} variant="secondary" icon="pencil" onClick=${() => openTransactionForm({ item, replace: true })}>Editar</${Button}>
      <${Button}
        variant="danger-ghost"
        icon="trash-2"
        onClick=${async () => {
          if (await deleteTransaction(item)) closeLayer();
        }}
      >
        Excluir
      </${Button}>
    </div>
  </div>`;
}

export function openTransactionDetail(item) {
  return openSheet((close) => html`<${TransactionDetail} id=${item.id} onClose=${close} />`);
}
