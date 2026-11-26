const test = require('node:test');
const assert = require('node:assert');
const Utilita = require('../utilita');

test('abbreviazioni comuni diventano parole intere', () => {
  assert.strictEqual(Utilita.espandi('vle zamboni'), 'viale zamboni');
  assert.strictEqual(Utilita.espandi('V.le Silvani'), 'viale silvani');
  assert.strictEqual(Utilita.espandi('p.zza maggiore'), 'piazza maggiore');
  assert.strictEqual(Utilita.espandi('pza maggiore'), 'piazza maggiore');
  assert.strictEqual(Utilita.espandi('staz. centrale'), 'stazione centrale');
  assert.strictEqual(Utilita.espandi('osp. sant\'orsola'), 'ospedale sant\'orsola');
});

test('le parole già intere non vengono toccate', () => {
  assert.strictEqual(Utilita.espandi('viale zamboni'), 'viale zamboni');
  assert.strictEqual(Utilita.espandi('via vale'), 'via vale');
});

test('distanza di edit', () => {
  assert.strictEqual(Utilita.distanzaEdit('zamboni', 'zamboni'), 0);
  assert.strictEqual(Utilita.distanzaEdit('zamboni', 'zambonl'), 1);
  assert.strictEqual(Utilita.distanzaEdit('', 'abc'), 3);
});

test('un errore di battitura trova la fermata', () => {
  assert.strictEqual(Utilita.vicina('viale zamboni', 'zambonl'), true);
  assert.strictEqual(Utilita.vicina('piazza maggiore', 'magglore'), true);
  // Parole diverse non devono passare: meglio nessun risultato che uno sbagliato.
  assert.strictEqual(Utilita.vicina('bologna centrale', 'bolognina'), false);
  assert.strictEqual(Utilita.vicina('via indipendenza', 'xambo'), false);
});

test('le query troppo corte restano esatte', () => {
  assert.strictEqual(Utilita.vicina('via xxx', 'yyy'), false);
  assert.strictEqual(Utilita.vicina('', 'viale'), false);
});
