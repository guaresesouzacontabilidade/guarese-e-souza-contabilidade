// Gerar cartões a partir do Notion: escolher páginas → ler → revisar por tópico → criar.
import { html, useEffect, useMemo, useState } from '../../vendor/preact.js';
import { callNotion, loadNotionPages } from '../../services/notion.js';
import { planNotionImport, applyNotionPlan, importedNotionPages } from '../../data/notionImport.js';
import { plainText } from '../../core/rich.js';
import { openSheet, SheetParts, toast, navigate } from '../state.js';
import { Icon, Segmented, plural } from '../components.js';

export function openNotionImport() {
  openSheet(({ close }) => html`<${NotionImport} close=${close} />`, { label: 'Cartões do Notion' });
}

const RULES = {
  toggle: 'toggle',
  definition: 'termo: definição',
  list: 'item com subitens',
  cloze: 'lacuna (negrito)',
  table: 'linha de tabela',
  question: 'pergunta',
};

function NotionImport({ close }) {
  const [step, setStep] = useState('pick'); // pick | loading | review
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('topic');
  const [progress, setProgress] = useState(null);
  const [pages, setPages] = useState([]);
  const [excluded, setExcluded] = useState({}); // pageId -> Set(topic)
  const [error, setError] = useState('');
  const imported = importedNotionPages();

  async function search(q = query) {
    setError('');
    setItems(null);
    try {
      const r = await callNotion('pages', { query: q });
      setItems(r.items);
    } catch (err) {
      setError(err.message);
      setItems([]);
    }
  }
  useEffect(() => {
    search('');
  }, []);
  useEffect(() => {
    if (step !== 'pick') return;
    const t = setTimeout(() => search(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function generate() {
    setStep('loading');
    setError('');
    try {
      const chosen = (items || []).filter((i) => selected.has(i.id));
      const loaded = await loadNotionPages(chosen, setProgress);
      setPages(loaded);
      setStep('review');
    } catch (err) {
      setError(err.message);
      setStep('pick');
    }
  }

  const plan = useMemo(
    () => (step === 'review' ? planNotionImport(pages.map((page) => ({ page, mode, excluded: [...(excluded[page.id] || [])] }))) : null),
    [step, pages, mode, excluded],
  );

  function flipTopic(pageId, name) {
    const set = new Set(excluded[pageId] || []);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    setExcluded({ ...excluded, [pageId]: set });
  }

  function create() {
    const list = pages.map((page) => ({ page, mode, excluded: [...(excluded[page.id] || [])] }));
    const { created, updated } = applyNotionPlan(plan, list);
    toast(created || updated ? `${plural(created, 'cartão criado', 'cartões criados')}${updated ? ` · ${updated} atualizado(s)` : ''} 🎉` : 'Nada novo para criar.');
    close();
    navigate('/');
  }

  if (step === 'loading') {
    return html`<${SheetParts} title="Lendo o Notion…" close=${close}>
      <div class="empty" style="box-shadow:none;background:transparent">
        <div class="empty__art notion-spin">📝</div>
        <h3 class="empty__title">${progress?.label ? `Lendo “${progress.label}”` : 'Buscando suas páginas'}</h3>
        <p class="empty__text">${progress?.total ? `${progress.index} de ${progress.total}` : ''} Páginas grandes podem levar alguns segundos.</p>
      </div>
    <//>`;
  }

  if (step === 'review' && plan) {
    const newCount = plan.create.length;
    const decksNew = plan.decks.length;
    return html`<${SheetParts}
      title="Revise os cartões"
      close=${close}
      foot=${html`
        <button class="btn btn--secondary" onClick=${() => setStep('pick')}>Voltar</button>
        <button class="btn btn--primary" disabled=${!newCount && !plan.update.length} onClick=${create}>
          ${newCount ? `Criar ${plural(newCount, 'cartão', 'cartões')}` : plan.update.length ? `Atualizar ${plan.update.length}` : 'Nada novo'}
        </button>
      `}
    >
      <div class="field">
        <span class="field__label">Organizar em</span>
        <${Segmented}
          label="Organização dos baralhos"
          value=${mode}
          onChange=${setMode}
          options=${[
            { id: 'topic', label: 'Um baralho por tópico' },
            { id: 'page', label: 'Um por página' },
          ]}
        />
      </div>
      <div class=${`notice ${newCount ? 'notice--ok' : ''}`} style="margin-bottom:14px">
        <${Icon} name=${newCount ? 'sparkles' : 'info'} size="sm" />
        <span>
          ${newCount ? `${plural(newCount, 'cartão novo', 'cartões novos')}${decksNew ? ` em ${plural(decksNew, 'baralho novo', 'baralhos novos')}` : ''}.` : 'Nenhum cartão novo.'}
          ${plan.unchanged ? ` ${plan.unchanged} já estavam no app.` : ''}
          ${plan.update.length ? ` ${plural(plan.update.length, 'mudou', 'mudaram')} no Notion e ${plan.update.length === 1 ? 'será atualizado' : 'serão atualizados'}.` : ''}
          ${plan.kept ? ` ${plan.kept} que você editou aqui ficam como estão.` : ''}
        </span>
      </div>
      ${plan.pages.map(
        (p) => html`<div class="notion-page">
          <div class="notion-page__head"><span>${p.icon || '📝'}</span> ${p.title}</div>
          ${!p.topics.length &&
          html`<p class="muted small" style="margin:6px 0 0">
            Não achei cartões nesta página. Dica: use toggles, “termo: definição”, subitens, tabelas ou **negrito** nas anotações.
          </p>`}
          ${p.topics.map(
            (t) => html`<label class=${`notion-topic ${t.included ? '' : 'is-off'}`}>
              <input type="checkbox" checked=${t.included} onChange=${() => flipTopic(p.id, t.name)} />
              <span class="notion-topic__body">
                <span class="notion-topic__name">${t.name} <span class="muted">· ${plural(t.count, 'cartão', 'cartões')}</span></span>
                ${t.sample.map((c) => html`<span class="notion-topic__card">${c.type === 'cloze' ? '🔲 ' : '❓ '}${plainText(c.front)}<em> · ${RULES[c.rule]}</em></span>`)}
              </span>
            </label>`,
          )}
        </div>`,
      )}
      ${pages.some((p) => p.truncated) &&
      html`<p class="muted small">Uma das páginas é muito grande: li só a primeira parte. Divida em páginas menores para trazer tudo.</p>`}
    <//>`;
  }

  const visible = items || [];
  return html`<${SheetParts}
    title="Cartões do Notion"
    close=${close}
    foot=${html`<button class="btn btn--primary" disabled=${!selected.size} onClick=${generate}>
      ${selected.size ? `Gerar cartões de ${plural(selected.size, 'página', 'páginas')}` : 'Escolha as páginas'}
    </button>`}
  >
    <p class="muted small" style="margin:0 0 12px">
      Escolha as páginas de anotações. Cada título da página vira um baralho, e o app cria os cartões a partir de toggles,
      “termo: definição”, subitens, tabelas, perguntas e trechos em **negrito**.
    </p>
    <div class="search">
      <${Icon} name="search" />
      <input type="search" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} placeholder="Buscar no Notion" aria-label="Buscar no Notion" />
    </div>
    ${error && html`<div class="notice notice--warn" role="alert" style="margin-bottom:10px"><${Icon} name="triangle-alert" size="sm" /> ${error}</div>`}
    ${items === null && html`<p class="muted" style="text-align:center">Carregando páginas…</p>`}
    ${items &&
    !visible.length &&
    !error &&
    html`<p class="muted small" style="text-align:center">
      Nenhuma página encontrada. No Notion, abra a página de anotações › <b>•••</b> › <b>Conexões</b> › <b>App da Lelé</b> e volte aqui.
    </p>`}
    <div class="note-list">
      ${visible.map(
        (it) => html`<label key=${it.id} class=${`note notion-item ${selected.has(it.id) ? 'is-selected' : ''}`}>
          <input type="checkbox" checked=${selected.has(it.id)} onChange=${() => toggle(it.id)} />
          <span class="notion-item__icon">${it.icon || (it.type === 'database' ? '🗂️' : '📄')}</span>
          <span class="note__body">
            <span class="note__title">${it.title}</span>
            <span class="note__sub">
              ${it.type === 'database' ? 'Base de dados: importa todas as páginas dela' : it.inDatabase ? 'Página de uma base de dados' : 'Página'}
              ${imported[it.id] ? ' · já importada' : ''}
            </span>
          </span>
        </label>`,
      )}
    </div>
  <//>`;
}

// Busca de novo as páginas já importadas e traz só o que é novo ou mudou.
export async function refreshFromNotion(onProgress) {
  const saved = importedNotionPages();
  const items = Object.entries(saved).map(([id, p]) => ({ id, type: 'page', title: p.title, group: p.group }));
  if (!items.length) return { created: 0, updated: 0 };
  const loaded = await loadNotionPages(items, onProgress);
  const list = loaded.map((page) => ({ page, mode: saved[page.id]?.mode || 'topic', excluded: saved[page.id]?.excluded || [] }));
  const plan = planNotionImport(list);
  return applyNotionPlan(plan, list);
}
