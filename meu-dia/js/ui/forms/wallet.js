// Carteiras: contas bancárias, dinheiro em espécie e cartões.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { WALLET_TYPES, walletBalance } from '../../core/finance.js';
import { formatMoney } from '../../core/money.js';
import { todayISO } from '../../core/dates.js';
import { Button, TextInput, Field, Chips, MoneyInput, SheetHeader, SheetActions, Hint } from '../components.js';
import { openSheet, closeLayer, confirm, toast } from '../state.js';
import { feedback } from '../../services/feedback.js';

function WalletForm({ item = null, onClose }) {
  const editing = Boolean(item);
  const [name, setName] = useState(item?.name || '');
  const [type, setType] = useState(item?.type || 'bank');
  const [balance, setBalance] = useState(item?.initialBalance || 0);
  const [error, setError] = useState('');

  const save = (e) => {
    e?.preventDefault();
    if (!name.trim()) {
      setError('Dê um nome, ex.: “Nubank”, “Carteira”.');
      return;
    }
    const data = { name: name.trim(), type, initialBalance: balance };
    if (editing) store.update('wallets', item.id, data);
    else store.create('wallets', data);
    toast(editing ? 'Carteira atualizada' : 'Carteira criada', { tone: 'success' });
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Excluir “${item.name}”?`,
      message: 'Os lançamentos continuam em Finanças, só deixam de somar no saldo desta carteira.',
      confirmLabel: 'Excluir carteira',
      danger: true,
    });
    if (!ok) return;
    store.remove('wallets', item.id);
    feedback('delete');
    toast('Carteira excluída', { action: { label: 'Desfazer', onClick: () => store.restore('wallets', item.id) } });
    closeLayer();
  };

  const current = item ? walletBalance(item, store.getState().transactions, todayISO()) : null;

  return html`<form class="form" onSubmit=${save} novalidate>
    <${SheetHeader} title=${editing ? 'Editar carteira' : 'Nova carteira'} subtitle="Onde seu dinheiro fica: banco, dinheiro ou cartão." onClose=${onClose} />
    <${Field} label="Tipo">
      <${Chips} label="Tipo" options=${WALLET_TYPES.map((t) => ({ id: t.id, label: t.short, icon: t.icon }))} value=${type} onChange=${(v) => setType(v || 'bank')} />
    </${Field}>
    <${TextInput}
      label="Nome"
      placeholder=${type === 'card' ? 'Ex.: Cartão Visa' : type === 'cash' ? 'Ex.: Dinheiro na carteira' : 'Ex.: Nubank, Caixa'}
      value=${name}
      onInput=${setName}
      error=${error}
      autofocus=${!editing}
      maxlength="60"
    />
    <${MoneyInput}
      label=${type === 'card' ? 'Saldo inicial (use − para fatura em aberto)' : 'Saldo inicial'}
      value=${balance}
      onChange=${setBalance}
      allowNegative
      hint=${editing ? `Saldo atual com os lançamentos: ${formatMoney(current)}` : 'Quanto há hoje. Os lançamentos ligados a esta carteira somam ou subtraem daqui.'}
    />
    ${type === 'card' && html`<${Hint}>Gastos no cartão deixam o saldo negativo (o valor da fatura). Ao pagar a fatura, registre uma receita nesta carteira ou ajuste o saldo.</${Hint}>`}
    <${SheetActions}>
      ${editing && html`<${Button} variant="danger-ghost" icon="trash-2" onClick=${remove}>Excluir</${Button}>`}
      <${Button} type="submit" size="lg" icon="check">${editing ? 'Salvar' : 'Criar carteira'}</${Button}>
    </${SheetActions}>
  </form>`;
}

export function openWalletForm(item = null) {
  return openSheet((close) => html`<${WalletForm} item=${item} onClose=${close} />`);
}
