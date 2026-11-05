// Importar extrato bancário ou fatura de cartão (PDF, OFX ou CSV), com revisão antes de salvar.
import { html, useMemo, useRef, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, formatNumeric, formatShort } from '../../core/dates.js';
import { formatMoney } from '../../core/money.js';
import { findCategory, categoriesFor, ruleKey, categoryHue } from '../../core/categories.js';
import { findPossibleDuplicates, walletType, live, byCategory } from '../../core/finance.js';
import { parseStatementText, parseOFX, parseCSV, totalsOf, importKey } from '../../core/statement.js';
import { periodLabel } from '../../core/reports.js';
import { plural, joinList } from '../../core/text.js';
import { Button, Icon, Field, Chips, Segmented, SheetHeader, SheetActions, Hint, Money, TextInput } from '../components.js';
import { openSheet, replaceSheet, goTo, toast } from '../state.js';
import { feedback } from '../../services/feedback.js';
import { celebrate } from '../fx.js';

const ACCEPT = '.pdf,.ofx,.qfx,.csv,.txt,application/pdf,text/csv';

// Lê texto tentando UTF-8 e, se aparecerem caracteres quebrados, Windows-1252 (comum em OFX/CSV de bancos).
async function readText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buf);
}

// Histórico e regras aprendidas ajudam a sugerir a categoria de cada linha.
function hints(mode) {
  const s = store.getState();
  return { today: todayISO(), mode, history: s.transactions, rules: s.settings.categoryRules || [], custom: s.settings.customCategories || [] };
}

async function parseFile(file, { password, mode } = {}) {
  const name = file.name.toLowerCase();
  const opts = hints(mode);
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { extractPdfText } = await import('../../services/pdf.js');
    const text = await extractPdfText(file, password);
    return { text, kind: 'text', result: parseStatementText(text, opts) };
  }
  const text = await readText(file);
  if (name.endsWith('.ofx') || name.endsWith('.qfx') || /<OFX>/i.test(text)) return { text, kind: 'ofx', result: parseOFX(text, opts) };
  if (name.endsWith('.csv')) return { text, kind: 'csv', result: parseCSV(text, opts) };
  return { text, kind: 'text', result: parseStatementText(text, opts) };
}

function reparse(kind, text, mode) {
  const opts = hints(mode);
  if (kind === 'ofx') return parseOFX(text, opts);
  if (kind === 'csv') return parseCSV(text, opts);
  return parseStatementText(text, opts);
}

// Marca o que provavelmente já está registrado.
function annotate(rows, source) {
  const s = store.getState();
  const imported = new Set(s.transactions.filter((t) => !t.deleted && t.importId).map((t) => t.importId));
  return rows.map((r) => {
    const key = importKey(r, source);
    const already = imported.has(key);
    const dup = !already && r.type !== 'transfer'
      ? findPossibleDuplicates(s.transactions, { type: r.type, amount: r.amount, date: r.date, description: r.description, windowDays: 3 })[0]
      : null;
    return { ...r, key, already, dup: dup || null, selected: r.type !== 'transfer' && !already && !dup };
  });
}

// ---------- Passo 1: escolher o arquivo ----------

function PickFile({ onClose }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needPassword, setNeedPassword] = useState(null); // arquivo aguardando senha
  const [password, setPassword] = useState('');

  const handle = async (file, pwd) => {
    setBusy(true);
    setError('');
    try {
      const parsed = await parseFile(file, { password: pwd });
      if (!parsed.result.rows.length) {
        setError('Não encontramos lançamentos neste arquivo. Se for um PDF, tente o arquivo OFX ou CSV do banco.');
        setBusy(false);
        return;
      }
      replaceSheet((close) => html`<${Review} file=${file.name} parsed=${parsed} onClose=${close} />`, { size: 'lg' });
    } catch (err) {
      setBusy(false);
      // PDF com senha: pede a senha e tenta de novo.
      if (typeof err?.wrong === 'boolean') {
        setNeedPassword(file);
        setError(err.wrong ? 'Senha incorreta. Tente de novo.' : '');
        return;
      }
      setError(err?.message || 'Não foi possível ler este arquivo.');
    }
  };

  return html`<div class="form">
    <${SheetHeader} title="Importar extrato ou fatura" subtitle="O app lê o arquivo e mostra o que entrou e o que saiu." onClose=${onClose} />
    ${needPassword
      ? html`<form
          class="form"
          onSubmit=${(e) => {
            e.preventDefault();
            handle(needPassword, password);
          }}
        >
          <${Hint} icon="lock">Este PDF está protegido. Muitos bancos usam parte do CPF como senha.</${Hint}>
          <${TextInput} label="Senha do PDF" type="password" value=${password} onInput=${setPassword} autofocus error=${error} autocomplete="off" />
          <${Button} type="submit" size="lg" disabled=${busy || !password}>${busy ? 'Lendo…' : 'Abrir'}</${Button}>
        </form>`
      : html`
          <ul class="sentences">
            <li><${Icon} name="file-up" size=${18} /><span><strong>PDF</strong> do extrato ou da fatura, baixado no app do banco.</span></li>
            <li><${Icon} name="database" size=${18} /><span><strong>OFX</strong> ou <strong>CSV</strong>: se o banco oferecer, prefira — a leitura é mais exata.</span></li>
            <li><${Icon} name="shield-check" size=${18} /><span>O arquivo é lido aqui no aparelho e não é enviado para lugar nenhum.</span></li>
          </ul>
          ${error && html`<p class="field-error" role="alert">${error}</p>`}
          <${Button} size="lg" icon=${busy ? 'refresh-cw' : 'file-up'} disabled=${busy} onClick=${() => input.current?.click()}>
            ${busy ? 'Lendo o arquivo…' : 'Escolher arquivo'}
          </${Button}>
          <${Hint}>Você revisa tudo antes de importar. Nada é salvo sem a sua confirmação.</${Hint}>
        `}
    <input
      ref=${input}
      type="file"
      accept=${ACCEPT}
      hidden
      onChange=${(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (file) handle(file);
      }}
    />
  </div>`;
}

// ---------- Passo 2: revisar ----------

function Review({ file, parsed, onClose }) {
  const s = store.getState();
  const custom = s.settings.customCategories || [];
  const wallets = live(s.wallets);
  const [mode, setMode] = useState(parsed.result.mode);
  const [rows, setRows] = useState(() => annotate(parsed.result.rows, file));
  const [walletId, setWalletId] = useState(null);
  const [picking, setPicking] = useState(null); // linha com as categorias abertas

  const changeMode = (m) => {
    setMode(m);
    setRows(annotate(reparse(parsed.kind, parsed.text, m).rows, file));
  };
  const toggle = (id) => setRows(rows.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  const flip = (id) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, type: r.type === 'income' ? 'expense' : 'income', category: null, selected: true } : r)));

  // Corrigir a categoria de uma linha também corrige as linhas da mesma loja (e vira regra ao importar).
  const pickCategory = (row, category) => {
    const key = ruleKey(row.description);
    let alsoChanged = 0;
    setRows(
      rows.map((r) => {
        if (r.id === row.id) return { ...r, category, userCategory: true };
        if (key && !r.userCategory && r.type === row.type && r.category !== category && ruleKey(r.description) === key) {
          alsoChanged++;
          return { ...r, category };
        }
        return r;
      }),
    );
    setPicking(null);
    if (alsoChanged) toast(`Também mudei ${plural(alsoChanged, 'linha parecida', 'linhas parecidas')} (“${key}”).`, { tone: 'success' });
  };

  const chosen = rows.filter((r) => r.selected && r.type !== 'transfer');
  const t = totalsOf(chosen);
  const cats = useMemo(() => byCategory(chosen.map((r) => ({ ...r, deleted: false })), 'expense', custom).slice(0, 3), [rows]);
  const dates = rows.map((r) => r.date).sort();

  const doImport = () => {
    store.createMany(
      'transactions',
      chosen.map((r) => ({
        type: r.type,
        amount: r.amount,
        description: r.description,
        date: r.date,
        category: r.category || null,
        walletId,
        notes: '',
        importId: r.key,
      })),
    );
    // O que a pessoa corrigiu vira regra para as próximas importações.
    const learned = [];
    for (const r of rows) {
      if (!r.userCategory || !r.category) continue;
      const rule = store.learnCategory({ description: r.description, type: r.type, category: r.category });
      if (rule) learned.push(`“${rule.match}” → ${findCategory(rule.category, rule.type, custom).label}`);
    }
    feedback('success');
    celebrate();
    toast(`${plural(chosen.length, 'lançamento importado', 'lançamentos importados')}`, { tone: 'success' });
    const from = chosen.map((r) => r.date).sort()[0];
    const to = chosen.map((r) => r.date).sort().at(-1);
    replaceSheet((close) => html`<${Done} totals=${t} cats=${cats} count=${chosen.length} from=${from} to=${to} learned=${learned} onClose=${close} />`);
  };

  return html`<div class="form">
    <${SheetHeader}
      title=${`${plural(rows.length, 'lançamento encontrado', 'lançamentos encontrados')}`}
      subtitle=${dates.length ? `${file} · ${periodLabel(dates[0], dates.at(-1))}` : file}
      onClose=${onClose}
    />
    <${Segmented}
      label="Tipo de documento"
      value=${mode}
      onChange=${changeMode}
      options=${[
        { id: 'bank', label: 'Extrato da conta', icon: 'landmark' },
        { id: 'card', label: 'Fatura do cartão', icon: 'credit-card' },
      ]}
    />
    <div class="import-summary" aria-live="polite">
      <div><span class="kpi-label">Entrou</span><strong class="amount-in"><${Money} value=${t.income} forceShow /></strong></div>
      <div><span class="kpi-label">Saiu</span><strong><${Money} value=${t.expense} forceShow /></strong></div>
      <div><span class="kpi-label">Saldo</span><strong class=${t.balance < 0 ? 'amount-neg' : ''}><${Money} value=${t.balance} forceShow /></strong></div>
    </div>
    ${cats.length > 0 && html`<p class="hero-hint">Maiores gastos: ${joinList(cats.map((c) => `${c.category.label} (${formatMoney(c.total)})`))}.</p>`}
    ${wallets.length > 0 &&
    html`<${Field} label="Lançar em qual carteira? (opcional)">
      <${Chips} label="Carteira" options=${wallets.map((w) => ({ id: w.id, label: w.name, icon: walletType(w.type).icon }))} value=${walletId} onChange=${setWalletId} />
    </${Field}>`}
    <${Hint}>Toque em um item para incluir ou tirar, na categoria para corrigir e em “Entrada/Saída” para trocar. Itens que parecem já registrados vêm desmarcados.</${Hint}>
    <div class="import-list" role="list">
      ${rows.map((r) => {
        const cat = r.category ? findCategory(r.category, r.type === 'transfer' ? 'expense' : r.type, custom) : null;
        return html`<div class=${`import-row ${r.selected ? 'is-on' : ''} ${picking === r.id ? 'is-picking' : ''}`} role="listitem" key=${r.id}>
          <button type="button" class="check" role="checkbox" aria-checked=${r.selected ? 'true' : 'false'} aria-label=${`Importar ${r.description}`} onClick=${() => toggle(r.id)} disabled=${r.type === 'transfer'}>
            <span class="check-ring"><${Icon} name="check" size=${16} /></span>
          </button>
          <button type="button" class="import-main" onClick=${() => r.type !== 'transfer' && toggle(r.id)}>
            <span class="item-title" style=${{ display: 'block' }}>${r.description}</span>
            <span class="item-sub">
              <span>${formatShort(r.date)}</span>
              ${r.already && html`<span class="badge is-accent">Já importado</span>`}
              ${r.dup && html`<span class="badge is-warning">Parece já registrado (${formatNumeric(r.dup.date).slice(0, 5)})</span>`}
              ${r.type === 'transfer' && html`<span class="badge">Pagamento da fatura · não conta</span>`}
              ${!r.confident && html`<span class="badge is-warning">Confira</span>`}
            </span>
          </button>
          ${r.type !== 'transfer' &&
          html`<button
            type="button"
            class=${`cat-pill ${cat ? '' : 'is-empty'}`}
            aria-expanded=${picking === r.id ? 'true' : 'false'}
            aria-label=${`Categoria de ${r.description}: ${cat ? cat.label : 'sem categoria'}. Trocar`}
            onClick=${() => setPicking(picking === r.id ? null : r.id)}
          >
            <span class="hue-ink" style=${{ '--h': categoryHue(cat) ?? 210 }}><${Icon} name=${cat ? cat.icon : 'tag'} size=${14} /></span><span>${cat ? cat.label : 'Categoria'}</span>
          </button>`}
          <div class="import-end">
            <span class=${`money ${r.type === 'income' ? 'amount-in' : ''}`}>${r.type === 'income' ? '+' : r.type === 'expense' ? '-' : ''}${formatMoney(r.amount)}</span>
            ${r.type !== 'transfer' &&
            html`<button type="button" class="type-toggle" onClick=${() => flip(r.id)} aria-label=${`Trocar para ${r.type === 'income' ? 'saída' : 'entrada'}`}>
              ${r.type === 'income' ? 'Entrada' : 'Saída'}
            </button>`}
          </div>
          ${picking === r.id &&
          html`<div class="import-cats">
            <${Chips} label=${`Categoria de ${r.description}`} options=${categoriesFor(r.type, custom)} value=${r.category} onChange=${(v) => pickCategory(r, v)} />
          </div>`}
        </div>`;
      })}
    </div>
    <${SheetActions}>
      <${Button} size="lg" icon="check" disabled=${!chosen.length} onClick=${doImport}>
        ${chosen.length ? `Importar ${plural(chosen.length, 'lançamento', 'lançamentos')}` : 'Nada selecionado'}
      </${Button}>
    </${SheetActions}>
  </div>`;
}

// ---------- Passo 3: análise ----------

function Done({ totals, cats, count, from, to, learned = [], onClose }) {
  return html`<div class="form">
    <${SheetHeader} title="Pronto!" subtitle=${`${plural(count, 'lançamento importado', 'lançamentos importados')} · ${periodLabel(from, to)}`} onClose=${onClose} />
    <ul class="sentences">
      <li><${Icon} name="arrow-down-left" size=${18} /><span>Entrou <strong>${formatMoney(totals.income)}</strong></span></li>
      <li><${Icon} name="arrow-up-right" size=${18} /><span>Saiu <strong>${formatMoney(totals.expense)}</strong></span></li>
      <li><${Icon} name="wallet" size=${18} /><span>${totals.balance >= 0 ? `Sobraram ${formatMoney(totals.balance)}` : `Faltaram ${formatMoney(-totals.balance)}`} no período.</span></li>
      ${cats.length > 0 && html`<li><${Icon} name="chart-pie" size=${18} /><span>Onde mais saiu: ${joinList(cats.map((c) => `${c.category.label} (${formatMoney(c.total)})`))}.</span></li>`}
      ${learned.length > 0 && html`<li><${Icon} name="wand-sparkles" size=${18} /><span>Aprendi com suas correções: ${joinList(learned)}. Vale para as próximas importações.</span></li>`}
    </ul>
    <div class="dialog-actions" style=${{ marginTop: 0 }}>
      <${Button} size="lg" icon="chart-column" onClick=${() => goTo(`/relatorios?periodo=custom&de=${from}&ate=${to}`)}>Ver relatório do período</${Button}>
      <${Button} size="lg" variant="secondary" onClick=${onClose}>Concluir</${Button}>
    </div>
  </div>`;
}

export function openImport({ replace = false } = {}) {
  const render = (close) => html`<${PickFile} onClose=${close} />`;
  return replace ? replaceSheet(render) : openSheet(render);
}
