import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRich, plainText, normalize, escapeHtml } from '../../js/core/rich.js';
import { clozeOrds, renderCloze, wrapCloze, autoNumber, nextClozeNumber } from '../../js/core/cloze.js';
import { renderSide, cardOrds, validateNote, imageOnSide, parseCardId, cardId } from '../../js/core/notes.js';

test('formatação: negrito, itálico, destaque, setas e listas', () => {
  const html = renderRich('**IAM** com *supra* ==ST==\nDor -> troponina\n\n- AAS\n- Clopidogrel');
  assert.equal(
    html,
    '<p><strong>IAM</strong> com <em>supra</em> <mark>ST</mark><br>Dor → troponina</p><ul><li>AAS</li><li>Clopidogrel</li></ul>',
  );
});

test('HTML digitado é escapado (nunca executado)', () => {
  const html = renderRich('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('lacunas: números, frente e verso', () => {
  const t = 'O {{c1::nervo frênico}} inerva o {{c2::diafragma::músculo}}';
  assert.deepEqual(clozeOrds(t), [1, 2]);
  assert.equal(renderCloze(t, 1, 'front'), '<p>O <span class="cloze">[…]</span> inerva o diafragma</p>');
  assert.equal(renderCloze(t, 2, 'front'), '<p>O nervo frênico inerva o <span class="cloze">[músculo]</span></p>');
  assert.equal(renderCloze(t, 2, 'back'), '<p>O nervo frênico inerva o <span class="cloze is-revealed">diafragma</span></p>');
  assert.equal(nextClozeNumber(t), 3);
});

test('ocultar trecho selecionado e numerar {{…}} automaticamente', () => {
  const { text, cursor } = wrapCloze('A aorta sai do VE', 2, 7);
  assert.equal(text, 'A {{c1::aorta}} sai do VE');
  assert.equal(cursor, 15);
  assert.equal(autoNumber('{{a}} e {{b}} e {{c1::c}}'), '{{c2::a}} e {{c3::b}} e {{c1::c}}');
});

test('texto puro e normalização para busca', () => {
  assert.equal(plainText('O **{{c1::nervo}}** ==X=='), 'O nervo X');
  assert.equal(normalize('Coração ÁTRIO'), 'coracao atrio');
});

test('notas: cartões gerados e validação', () => {
  assert.deepEqual(cardOrds({ type: 'basic', front: 'a', back: 'b' }), [0]);
  assert.deepEqual(cardOrds({ type: 'reverse', front: 'a', back: 'b' }), [0, 1]);
  assert.deepEqual(cardOrds({ type: 'cloze', front: '{{c1::a}} {{c3::b}}' }), [1, 3]);
  assert.deepEqual(cardOrds({ type: 'basic', front: 'a', back: 'b', deleted: true }), []);
  assert.equal(validateNote({ deckId: 'd', type: 'cloze', front: 'sem lacuna' }).includes('lacuna'), true);
  assert.equal(validateNote({ deckId: 'd', type: 'basic', front: 'P', back: 'R' }), null);
  assert.equal(validateNote({ type: 'basic', front: 'P', back: 'R' }), 'Escolha um baralho.');
});

test('invertido troca pergunta e resposta', () => {
  const note = { type: 'reverse', front: 'Taquicardia', back: 'FC > 100' };
  assert.equal(renderSide(note, 1, 'front'), '<p>FC &gt; 100</p>');
  assert.equal(renderSide(note, 1, 'back'), '<p>Taquicardia</p>');
  assert.equal(imageOnSide({ ...note, image: 'm', imageSide: 'front' }, 1, 'front'), false);
  assert.equal(imageOnSide({ ...note, image: 'm', imageSide: 'front' }, 0, 'front'), true);
});

test('id do cartão', () => {
  assert.deepEqual(parseCardId(cardId('n~x', 2)), { noteId: 'n~x', ord: 2 });
});
