'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Icone = require('../icone');

test('tutte le icone UI sono Lucide inline e non Material', () => {
  const richieste = [
    'x', 'arrow-up-down', 'credit-card', 'crosshair', 'locate-fixed', 'maximize',
    'bus-front', 'train-front', 'map-pin', 'map-pin-pieno', 'footprints',
    'accessibility', 'refresh-cw', 'info', 'chevron-down', 'chevron-right',
    'triangle-alert'
  ];
  assert.deepEqual(richieste.sort(), Icone.nomi.slice().sort());
  richieste.forEach((nome) => {
    const html = Icone.svg(nome, 18);
    assert.match(html, /class="lucide lucide-/);
    assert.match(html, /viewBox="0 0 24 24"/);
    assert.match(html, /fill="none"/);
    assert.doesNotMatch(html, /material/i);
  });
});

test('camminare e accessibilità hanno icone distinte', () => {
  const piedi = Icone.svg('footprints', 16);
  const accessibile = Icone.svg('accessibility', 16);
  assert.match(piedi, /lucide-footprints/);
  assert.match(accessibile, /lucide-accessibility/);
  assert.notEqual(piedi, accessibile);
});

test('dimensioni e classi aggiuntive vengono rispettate', () => {
  const html = Icone.svg('chevron-right', 18, 'voce-freccia');
  assert.match(html, /width="18"/);
  assert.match(html, /class="lucide lucide-chevron-right voce-freccia"/);
  assert.throws(() => Icone.svg('icona-inesistente'), /sconosciuta/);
});

test('il pin della mappa usa la variante piena Lucide', () => {
  const html = Icone.svg('map-pin-pieno', 34, '', { fill: '#C1121F', stroke: '#fff', strokeWidth: 1.3 });
  assert.match(html, /width="34"/);
  assert.match(html, /fill="#C1121F"/);
  assert.match(html, /stroke="#fff"/);
  assert.match(html, /stroke-width="1.3"/);
  assert.match(html, /fill="#fff"/);
});
