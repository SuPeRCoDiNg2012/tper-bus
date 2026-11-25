'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const API = require('../scripts/aggiorna-dati.js');

test('versione GTFS: letta dalla pagina SolWeb', () => {
  const html = '<a href="open-data-download.aspx?source=solweb.tper.it&amp;filename=gommagtfsbo&amp;version=20261123&amp;format=zip">Scarica</a>';
  assert.equal(API.versioneDaDettaglio(html), '20261123');

  const dettaglio = '<p>Open data: Rete bus Bologna in formato gtfs</p><p>Versione: 20260522</p>';
  assert.equal(API.versioneDaDettaglio(dettaglio), '20260522');
});

test('versione GTFS: pagina senza versione', () => {
  assert.equal(API.versioneDaDettaglio('<p>manutenzione in corso</p>'), null);
  assert.equal(API.versioneDaDettaglio(''), null);
});

test('URL del GTFS: contiene nome file e versione', () => {
  const url = API.urlGtfs('20261123');
  assert.match(url, /filename=gommagtfsbo/);
  assert.match(url, /version=20261123/);
  assert.match(url, /format=zip/);
});

test('CKAN: sceglie la risorsa JSON e ignora le altre', () => {
  const risposta = {
    result: {
      resources: [
        { format: 'CSV', url: 'https://esempio/dati.csv' },
        { format: 'JSON', url: 'https://esempio/dati.json' }
      ]
    }
  };
  assert.equal(API.risorsaJsonCkan(risposta), 'https://esempio/dati.json');
  assert.equal(API.risorsaJsonCkan({ result: { resources: [] } }), null);
  assert.equal(API.risorsaJsonCkan(null), null);
});

test('CKAN: il JSON-LD non è il JSON piatto che serve', () => {
  const risposta = {
    result: {
      resources: [
        { format: 'JSON_LD', url: 'https://esempio/exports/jsonld' },
        { format: 'JSON', url: 'https://esempio/exports/jsonl' },
        { format: 'GeoJSON', url: 'https://esempio/exports/geojson' },
        { format: 'JSON', url: 'https://esempio/exports/json' }
      ]
    }
  };
  assert.equal(API.risorsaJsonCkan(risposta), 'https://esempio/exports/json');
});

test('fermate: riconosce l\'elenco dei record fermata+linea', () => {
  const record = { codice: 2, codice_linea: '61', codice_zona: 500 };
  const elenco = new Array(6000).fill(record);
  assert.equal(API.sembraDatasetFermate(elenco), true);
  assert.equal(API.sembraDatasetFermate([record]), false, 'troppo corto');
  assert.equal(API.sembraDatasetFermate(elenco.map(() => ({ '@id': 'x' }))), false, 'JSON-LD');
  assert.equal(API.sembraDatasetFermate({ fermate: [] }), false);
});

test('soglia di riduzione: blocca i cali oltre il 10%', () => {
  assert.equal(API.riduzioneAccettabile(9603, 9603), true);
  assert.equal(API.riduzioneAccettabile(9603, 9000), true);
  assert.equal(API.riduzioneAccettabile(9603, 8000), false);
  assert.equal(API.riduzioneAccettabile(0, 10), true);
  assert.equal(API.riduzioneAccettabile(100, NaN), false);
  assert.equal(API.riduzioneAccettabile(100, 85, 0.8), true);
});

test('confronto: la sola data non conta come modifica', () => {
  const vecchio = { aggiornato: '2026-11-24', fonte: 'x', fermate: [{ id: '1', nome: 'A' }] };
  const nuovo = { aggiornato: '2026-11-25', fonte: 'y', fermate: [{ id: '1', nome: 'A' }] };
  assert.equal(API.stessoContenuto(vecchio, nuovo), true);
});

test('confronto: un dato diverso è una modifica', () => {
  const vecchio = { aggiornato: '2026-11-24', fermate: [{ id: '1', nome: 'A' }] };
  const nuovo = { aggiornato: '2026-11-24', fermate: [{ id: '1', nome: 'B' }] };
  assert.equal(API.stessoContenuto(vecchio, nuovo), false);
  assert.equal(API.stessoContenuto(null, nuovo), false);
});

test('senzaData: toglie la data anche negli elenchi annidati', () => {
  const pulito = API.senzaData({ aggiornato: '2026-11-25', corse: [{ aggiornato: '2026-11-25', n: 1 }] });
  assert.deepEqual(pulito, { corse: [{ n: 1 }] });
});
