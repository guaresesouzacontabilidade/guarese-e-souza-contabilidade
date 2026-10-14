// Receitas e despesas: registro rápido, compras parceladas, detalhes, edição e exclusão.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, formatLongDate, formatNumeric, isValidISODate, MONTHS_SHORT } from '../../core/dates.js';
import { formatMoney, formatPercent, sumBy } from '../../core/money.js';
import { categoriesFor, findCategory, suggestCategory, ruleMatches } from '../../core/categories.js';
import { findPossibleDuplicates, walletType, live, categoryLimits, limitWarning } from '../../core/finance.js';
import { planInstallments, groupItems, MAX_INSTALLMENTS } from '../../core/installments.js';
import { uid, plural } from '../../core/text.js';
import {
  Button, TextInput, TextArea, DateField, Field, Chips, Segmented, MoneyInput, Details, SheetHeader, SheetActions, Icon, Money, CategoryIcon, Hint, Toggle, Select,
} from '../components.js';
import { listen, voiceAvailable } from '../../services/voice.js';
import { parseQuickEntry } from '../../core/quickEntry.js';
import { openSheet, replaceSheet, closeLayer, confirm, choose, toast } from '../state.js';
import { haptic } from '../../services/feedback.js';

const TYPE_LABEL = { expense: 'Despesa', income: 'Receita' };
const VISIBLE_CATS = 7;
const COUNT_OPTIONS = Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, i) => ({ id: i + 2, label: `${i + 2}x` }));
const monthShort = (iso) => `${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

// Lê a frase falada usando as regras de categoria que o app já aprendeu.
function parseSpoken(text) {
  const s = store.getState();
  return parseQuickEntry(text, todayISO(), s.transactions, s.settings.categoryRules, s.settings.customCategories);
}

// Quanto já foi gasto este mês em cada categoria com limite.
export function limitSnapshot() {
  const s = store.getState();
  return categoryLimits(s.settings.categoryBudgets, s.transactions, todayISO(), s.settings.customCategories);
}

// Depois de salvar: avisa se alguma categoria chegou a 80% ou ao limite do mês.
export function warnLimits(before) {
  for (const a of limitSnapshot()) {
    const b = before.find((x) => x.id === a.id);
    const kind = limitWarning(a.budget, b ? b.spent : 0, a.spent);
    if (!kind) continue;
    haptic('warning');
    const amounts = `${formatMoney(a.spent)} de ${formatMoney(a.budget)}`;
    toast(
      kind === 'over'
        ? `${a.category.label} ${a.spent > a.budget ? 'passou do' : 'chegou ao'} limite do mês: ${amounts}.`
        : `Atenção: ${a.category.label} já usou ${formatPercent(a.ratio)} do limite do mês (${amounts}).`,
      { tone: 'warning', duration: 6000 },
    );
  }
}

// Aprende quando a pessoa escolhe uma categoria diferente da que o app sugeriria.
function learnFrom({ description, type, category }) {
  if (!category) return null;
  const s = store.getState();
  const auto = suggestCategory(description, type, [], s.settings.customCategories, s.settings.categoryRules);
  if (auto === category) return null;
  return store.learnCategory({ description, type, category });
}

const ruleText = (rule, type) =>
  rule ? ` Daqui pra frente, “${rule.match}” vai para ${findCategory(rule.category, type, store.getState().settings.customCategories).label}.` : '';

export function TransactionForm({ type: initialType = 'expense', item = null, date, prefill = null, heard = '', onClose }) {
  const s = store.getState();
  const custom = s.settings.customCategories || [];
  const editing = Boolean(item);
  const [type, setType] = useState(item?.type || prefill?.type || initialType);
  const [amount, setAmount] = useState(item?.amount || prefill?.amount || 0);
  const [description, setDescription] = useState(item?.description || prefill?.description || '');
  const [day, setDay] = useState(item?.date || prefill?.date || date || todayISO());
  const [category, setCategory] = useState(item?.category || prefill?.category || null);
  const [pickedCategory, setPicked] = useState(Boolean(item?.category));
  const [heardText, setHeard] = useState(heard);
  const [split, setSplit] = useState(false);
  const [count, setCount] = useState(10);
  const [perInstallment, setPerInstallment] = useState(false);

  const fillByVoice = async () => {
    try {
      const text = await listen('Ex.: “gastei 45 reais de gasolina”');
      if (!text) return;
      const p = parseSpoken(text);
      setHeard(text);
      setType(p.type);
      if (p.amount) setAmount(p.amount);
      if (p.description) setDescription(p.description);
      setDay(p.date);
      setCategory(p.category);
      setPicked(false);
    } catch (err) {
      toast(err.message, { tone: 'warning' });
    }
  };
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

  const rules = s.settings.categoryRules || [];
  const onDescription = (value) => {
    setDescription(value);
    if (!pickedCategory) setCategory(suggestCategory(value, type, s.transactions, custom, rules));
  };
  const onType = (t) => {
    setType(t);
    if (!pickedCategory || !categoriesFor(t, custom).some((c) => c.id === category)) {
      setPicked(false);
      setCategory(suggestCategory(description, t, s.transactions, custom, rules));
    }
  };

  // Compra parcelada: só ao registrar uma despesa nova.
  const splitting = !editing && type === 'expense' && split;
  const preview = splitting && amount > 0 && isValidISODate(day) ? planInstallments({ amount, date: day }, { count, perInstallment, group: 'previa' }) : null;

  const save = async (e) => {
    e?.preventDefault();
    const errs = {};
    if (!amount || amount <= 0) errs.amount = 'Digite o valor.';
    else if (splitting && !perInstallment && amount < count) errs.amount = `Valor baixo demais para ${count} parcelas.`;
    if (!description.trim()) errs.description = type === 'expense' ? 'Diga com o que gastou, ex.: “Mercado”.' : 'Diga de onde veio, ex.: “Salário”.';
    if (!isValidISODate(day)) errs.date = 'Escolha uma data.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const data = { type, amount, description: description.trim(), date: day, category, walletId: walletId || null, notes: notes.trim() };
    const before = limitSnapshot();
    // Só aprende com uma escolha feita agora (não com a categoria que o item já tinha).
    const changedCategory = editing ? category !== item.category : pickedCategory;
    if (!editing) {
      const dup = !splitting && findPossibleDuplicates(s.transactions, { type, amount, date: day, description })[0];
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
      const created = splitting
        ? store.createMany('transactions', planInstallments(data, { count, perInstallment, group: uid() }))
        : [store.create('transactions', data)];
      const rule = changedCategory ? learnFrom(data) : null;
      haptic('light');
      const label = splitting
        ? `Compra parcelada registrada: ${count}x de ${formatMoney(created[created.length - 1].amount)}.`
        : `${TYPE_LABEL[type]} de ${formatMoney(amount)} registrada.`;
      toast(`${label}${ruleText(rule, type)}`, {
        tone: 'success',
        duration: rule ? 6500 : 4500,
        action: { label: 'Desfazer', onClick: () => created.forEach((c) => store.remove('transactions', c.id)) },
      });
    } else {
      store.update('transactions', item.id, data);
      // Parcelas: descrição, categoria, carteira e observações valem para a compra toda.
      let others = 0;
      if (item.installment) {
        const shared = { description: data.description, category: data.category, walletId: data.walletId, notes: data.notes };
        for (const t of groupItems(store.getState().transactions, item.installment.group)) {
          if (t.id === item.id || Object.keys(shared).every((k) => (t[k] ?? null) === (shared[k] ?? null))) continue;
          store.update('transactions', t.id, shared);
          others++;
        }
      }
      const rule = changedCategory ? learnFrom(data) : null;
      // Oferece corrigir também os lançamentos antigos da mesma loja.
      const similar = rule
        ? store.getState().transactions.filter(
            (t) => !t.deleted && t.id !== item.id && t.type === type && t.category !== category && !(item.installment && t.installment?.group === item.installment.group) && ruleMatches(rule, t.description),
          )
        : [];
      toast(`${TYPE_LABEL[type]} atualizada${others ? ` (e mais ${plural(others, 'parcela', 'parcelas')})` : ''}.${ruleText(rule, type)}`, {
        tone: 'success',
        duration: similar.length ? 8000 : rule ? 6500 : 4500,
        action: similar.length
          ? {
              label: `Mudar ${plural(similar.length, 'parecida', 'parecidas')}`,
              onClick: () => {
                similar.forEach((t) => store.update('transactions', t.id, { category }));
                toast(`${plural(similar.length, 'lançamento mudou', 'lançamentos mudaram')} de categoria.`, { tone: 'success' });
              },
            }
          : undefined,
      });
    }
    warnLimits(before);
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
    <${MoneyInput}
      big
      label=${splitting ? (perInstallment ? 'Valor de cada parcela' : 'Valor total da compra') : 'Valor'}
      value=${amount}
      onChange=${setAmount}
      error=${errors.amount}
      autoFocus=${!editing && !prefill}
    />
    ${!editing && voiceAvailable() && html`<${Button} variant="secondary" icon="mic" onClick=${fillByVoice}>Preencher falando</${Button}>`}
    ${heardText && html`<${Hint} icon="mic">Ouvi: “${heardText}”. Confira e toque em registrar.</${Hint}>`}
    ${!editing && type === 'expense' && html`<${Toggle} label="Compra parcelada" description="Lança uma parcela por mês" checked=${split} onChange=${setSplit} />`}
    ${splitting &&
    html`<div class="split-box">
      <${Select} label="Quantas parcelas?" value=${count} onChange=${(v) => setCount(Number(v))} options=${COUNT_OPTIONS} />
      <${Segmented}
        label="O valor digitado é"
        value=${perInstallment ? 'each' : 'total'}
        onChange=${(v) => setPerInstallment(v === 'each')}
        options=${[
          { id: 'total', label: 'Total da compra' },
          { id: 'each', label: 'Cada parcela' },
        ]}
      />
      ${preview &&
      html`<${Hint} icon="calendar-range"
        ><strong>${count}x de ${formatMoney(preview[preview.length - 1].amount)}</strong>${preview[0].amount !== preview[preview.length - 1].amount
          ? ` (a 1ª de ${formatMoney(preview[0].amount)})`
          : ''}${` · total ${formatMoney(preview[0].installment.total)} · de ${monthShort(preview[0].date)} a ${monthShort(preview[preview.length - 1].date)}`}</${Hint}
      >`}
    </div>`}
    ${editing &&
    item.installment &&
    html`<${Hint} icon="calendar-range">Parcela ${item.installment.n} de ${item.installment.of}. Descrição, categoria, carteira e observações mudam em todas as parcelas; valor e data, só nesta.</${Hint}>`}
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
    <${DateField} label=${splitting ? 'Data da 1ª parcela' : 'Data'} value=${day} onChange=${setDay} past error=${errors.date} />
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
      <${Button} type="submit" size="lg" icon="check">${editing ? 'Salvar alterações' : splitting ? `Registrar ${count} parcelas` : `Registrar ${TYPE_LABEL[type].toLowerCase()}`}</${Button}>
    </${SheetActions}>
  </form>`;
}

// Atalho "Falar um gasto": ouve, entende e abre o formulário já preenchido para conferir.
export async function startVoiceEntry({ replace = false } = {}) {
  try {
    const text = await listen('Diga o gasto. Ex.: “gastei 45 reais de gasolina”');
    if (!text) return;
    const prefill = parseSpoken(text);
    openTransactionForm({ type: prefill.type, prefill, heard: text, replace });
  } catch (err) {
    toast(err.message, { tone: 'warning' });
  }
}

export function openTransactionForm(opts = {}) {
  const render = (close) => html`<${TransactionForm} ...${opts} onClose=${close} />`;
  return opts.replace ? replaceSheet(render) : openSheet(render);
}

async function deleteInstallments(item) {
  const all = groupItems(store.getState().transactions, item.installment.group);
  const fromHere = all.filter((t) => t.installment.n >= item.installment.n);
  const options = [{ value: 'one', label: 'Só esta parcela', variant: 'danger' }];
  if (fromHere.length > 1 && fromHere.length < all.length) options.push({ value: 'next', label: `Esta e as próximas (${fromHere.length})`, variant: 'danger' });
  if (all.length > 1) options.push({ value: 'all', label: `Todas as ${all.length} parcelas`, variant: 'danger' });
  options.push({ value: null, label: 'Cancelar', variant: 'secondary' });
  const choice = await choose({
    title: `Excluir “${item.description}”?`,
    message: `Parcela ${item.installment.n} de ${item.installment.of}, ${formatMoney(item.amount)} em ${formatNumeric(item.date)}.`,
    icon: 'trash-2',
    danger: true,
    options,
  });
  if (!choice) return false;
  const list = choice === 'all' ? all : choice === 'next' ? fromHere : [item];
  list.forEach((t) => store.remove('transactions', t.id));
  toast(list.length === 1 ? 'Parcela excluída' : `${list.length} parcelas excluídas (${formatMoney(sumBy(list, (t) => t.amount))})`, {
    action: { label: 'Desfazer', onClick: () => list.forEach((t) => store.restore('transactions', t.id)) },
  });
  return true;
}

export async function deleteTransaction(item) {
  if (item.installment) return deleteInstallments(item);
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
  const parts = item.installment ? groupItems(s.transactions, item.installment.group) : [];
  const later = parts.filter((t) => t.installment.n > item.installment.n);
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
      ${item.installment &&
      html`<li>
        <${Icon} name="calendar-range" size=${18} />
        <span>
          Parcela <strong>${item.installment.n} de ${item.installment.of}</strong> de uma compra de ${formatMoney(item.installment.total)}.
          ${later.length ? ` Depois desta, ${later.length === 1 ? 'falta 1 parcela' : `faltam ${later.length} parcelas`} (${formatMoney(sumBy(later, (t) => t.amount))}), até ${formatNumeric(later[later.length - 1].date)}.` : ' É a última parcela.'}
        </span>
      </li>`}
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
