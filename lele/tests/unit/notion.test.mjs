import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageToCards, matchDefinition, toCloze, renderBlocks, ruleCounts } from '../../js/core/notionCards.js';

const page = JSON.parse(readFileSync(new URL('../fixtures/notion-cardio.json', import.meta.url)));

test('um baralho por tópico (títulos de nível mais alto)', () => {
  const r = pageToCards(page, { mode: 'topic' });
  assert.deepEqual(r.topics.map((t) => t.name), ['Insuficiência cardíaca', 'Pericardite']);
  const ic = r.topics[0].cards;
  assert.deepEqual(ic.map((c) => c.rule), ['definition', 'list', 'cloze', 'toggle']);
  assert.equal(ic[0].front, 'Furosemida');
  assert.equal(ic[0].back, 'diurético de alça, alivia congestão');
  assert.equal(ic[1].front, 'Classificação NYHA');
  assert.equal(ic[1].back, '- I: sem limitação\n- IV: sintomas em repouso');
  assert.equal(ic[2].front, 'A principal causa de IC no Brasil é a {{c1::cardiopatia isquêmica}}, seguida da {{c2::hipertensiva}}.');
  assert.equal(ic[3].front, 'Quais drogas reduzem mortalidade na ICFEr?');
  assert.ok(ic[3].back.includes('- iSGLT2'));
  // Subtítulo vira contexto do cartão.
  assert.equal(ic[3].context, 'Tratamento');
  assert.equal(ic[0].context, '');
});

test('pergunta + resposta no bloco seguinte, tabela, e o que não vira cartão', () => {
  const r = pageToCards(page, { mode: 'topic' });
  const peri = r.topics[1].cards;
  assert.deepEqual(peri.map((c) => c.rule), ['question', 'table', 'table']);
  assert.equal(peri[0].back, 'Supra de ST difuso com infra de PR');
  assert.equal(peri[1].front, 'AAS');
  assert.equal(peri[1].back, '**Dose:** 750–1000 mg 8/8h\n**Duração:** 1–2 semanas');
  // Título em negrito, texto corrido e horário não viram cartão.
  const all = r.topics.flatMap((t) => t.cards.map((c) => c.front));
  assert.ok(!all.some((f) => /título em negrito|Resumo da aula|10:30/.test(f)));
  assert.equal(r.total, 7);
  assert.deepEqual(ruleCounts(r), { definition: 1, list: 1, cloze: 1, toggle: 1, question: 1, table: 2 });
});

test('modo página: tudo num baralho, com o título como contexto', () => {
  const r = pageToCards(page, { mode: 'page' });
  assert.equal(r.topics.length, 1);
  assert.equal(r.topics[0].name, 'Cardiologia');
  assert.equal(r.topics[0].cards.find((c) => c.rule === 'toggle').context, 'Insuficiência cardíaca › Tratamento');
});

test('ids e hash estáveis: mesma página gera os mesmos cartões', () => {
  const a = pageToCards(page);
  const b = pageToCards(JSON.parse(JSON.stringify(page)));
  assert.deepEqual(a.topics[0].cards.map((c) => [c.id, c.hash]), b.topics[0].cards.map((c) => [c.id, c.hash]));
  const changed = JSON.parse(JSON.stringify(page));
  changed.blocks[2].text = '**Furosemida**: diurético de alça';
  const c = pageToCards(changed);
  assert.equal(c.topics[0].cards[0].id, a.topics[0].cards[0].id);
  assert.notEqual(c.topics[0].cards[0].hash, a.topics[0].cards[0].hash);
});

test('padrões de definição e lacunas', () => {
  assert.deepEqual(matchDefinition('Taquicardia -> FC > 100 bpm'), { term: 'Taquicardia', definition: 'FC > 100 bpm' });
  assert.deepEqual(matchDefinition('**Sinal de Kussmaul** — aumento da PVJ na inspiração'), { term: 'Sinal de Kussmaul', definition: 'aumento da PVJ na inspiração' });
  assert.equal(matchDefinition('Às 10:30 tem aula'), null);
  assert.equal(matchDefinition('Veja https://site.com'), null);
  assert.equal(matchDefinition('Uma frase muito longa com muitas palavras antes dos dois pontos aqui: e depois'), null);
  assert.equal(toCloze('Sem destaque'), null);
  assert.equal(toCloze('**Tudo em negrito**'), null);
  assert.equal(toCloze('O **VE** bombeia para a **aorta**'), 'O {{c1::VE}} bombeia para a {{c2::aorta}}');
});

test('toggles aninhados viram contexto, e os de dentro viram cartões', () => {
  const r = pageToCards({
    id: 'p', title: 'Farmaco', blocks: [
      { id: 't1', type: 'toggle', text: 'Antibióticos', children: [
        { id: 't2', type: 'toggle', text: 'Mecanismo da penicilina?', children: [{ id: 'x', type: 'paragraph', text: 'Inibe a síntese da parede' }] },
      ] },
    ],
  });
  assert.equal(r.total, 1);
  assert.equal(r.topics[0].cards[0].context, 'Antibióticos');
  assert.equal(renderBlocks([{ type: 'numbered', text: 'a' }, { type: 'numbered', text: 'b' }]), '1. a\n2. b');
});
