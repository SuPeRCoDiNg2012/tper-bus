const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../intelligenza.js');

// I sette test della Parte 9.1, scritti come li prescrive il prompt: ogni
// numero qui è una promessa fatta all'utente, non un'opinione.

test('il ritardo live si propaga a cascata', () => {
  const tappe = [
    { tipo: 'bus', linea: '20', arrivo: 1000, partenza: 1000, ritardoLive: 240 },
    { tipo: 'bus', linea: '27', arrivo: 1900, partenza: 1900, ritardoLive: null }
  ];
  assert.equal(I.ritardoCascata(tappe), 240);
  // L'arrivo finale slitta di 4 minuti: la somma dei tempi non cambia, il
  // momento in cui l'utente scende sì.
  assert.equal(1000 + 900 + I.ritardoCascata(tappe), 2140);
});

test('il cambio è a rischio quando il ritardo mangia il buffer', () => {
  const arrivo = { arrivo: 1000, ritardoLive: 120 };
  const partenza = { partenza: 1090 };
  // Buffer dichiarato 90 s, ritardo 120 s: si parte 30 secondi prima di
  // arrivare, cioè il cambio è già perso.
  assert.equal(I.bufferEffettivo(arrivo, partenza), -30);
  assert.ok(I.probabilitaCambio(-30) > 0.5);
  const rischi = I.rischioCambi([arrivo, partenza]);
  assert.equal(rischi.length, 1);
  assert.equal(rischi[0].probabilita, 0.9);
});

test('senza ritardo un cambio con margine è sicuro', () => {
  // 90 secondi di buffer restano a rischio anche senza ritardo: è la soglia
  // del prompt, non un caso limite. Con 400 secondi il cambio è sicuro.
  assert.equal(I.rischioCambi([{ arrivo: 1000, ritardoLive: 0 }, { partenza: 1090 }]).length, 1);
  const rischi = I.rischioCambi([{ arrivo: 1000, ritardoLive: 0 }, { partenza: 1400 }]);
  assert.equal(rischi.length, 0);
  assert.equal(I.probabilitaCambio(600), 0.05);
});

test("l'affidabilità rompe il pareggio", () => {
  const base = { tempoTotale: 1800, cambi: 1, metriCammino: 200, tempoAttesa: 300 };
  const affidabile = I.punteggioCombinato(Object.assign({}, base, { affidabilita: 0.9 }));
  const incerto = I.punteggioCombinato(Object.assign({}, base, { affidabilita: 0.5 }));
  assert.ok(affidabile < incerto, 'a pari tempo vince il percorso più affidabile');
  assert.equal(incerto - affidabile, 48); // (0.9 - 0.5) * 120
});

test('lo storico non salva coordinate GPS', () => {
  const elenco = I.registraOsservazione([], { linea: '20', giorno: 3, ora: 8, ritardo: 120, lat: 44.49, lon: 11.34 }, 1000);
  assert.equal(elenco.length, 1);
  assert.deepEqual(Object.keys(elenco[0]).sort(), ['giorno', 'linea', 'ora', 'ritardo', 'ts']);
});

test('lo storico tiene il tetto e scarta il vecchio', () => {
  let elenco = [];
  const adesso = 30 * 24 * 3600 * 1000;
  for (let i = 0; i < 520; i += 1) {
    elenco = I.registraOsservazione(elenco, { linea: '20', giorno: 1, ora: 8, ritardo: 60 }, adesso + i);
  }
  assert.equal(elenco.length, I.SOGLIE.OSSERVAZIONI_MAX);
  // Un giorno dopo la scadenza dei 30 giorni l'osservazione vecchia sparisce.
  const vecchio = I.registraOsservazione([{ linea: '20', ritardo: 60, ts: 0 }], { linea: '20', ritardo: 60 }, adesso + 24 * 3600 * 1000);
  assert.equal(vecchio.length, 1, 'la osservazione scaduta non resta');
});

test('la mediana regge un bus in ritardo di mezz\'ora', () => {
  const stat = I.statistiche([{ ritardo: 60 }, { ritardo: 60 }, { ritardo: 120 }, { ritardo: 1800 }]);
  assert.equal(stat.n, 4);
  assert.equal(stat.mediana, 90);
  assert.equal(stat.affidabilita, 0.5, 'sotto le 5 osservazioni resta neutra');
  const con5 = I.statistiche([{ ritardo: 60 }, { ritardo: 60 }, { ritardo: 60 }, { ritardo: 120 }, { ritardo: 60 }]);
  assert.ok(con5.affidabilita >= 0.75);
  assert.equal(I.statistiche([]).affidabilita, 0.5);
});

test('il meteo penalizza il cammino lungo, non quello corto', () => {
  const pioggia = { precipitazione: 2, vento: 10, temperatura: 12 };
  assert.ok(I.aggiustamentoMeteo(pioggia, 600, 300) > 0);
  assert.equal(I.aggiustamentoMeteo(pioggia, 300, 300), 0);
  assert.equal(I.aggiustamentoMeteo(null, 900, 900), 0, 'senza meteo nessun aggiustamento');
  // Il caldo pesa sull'attesa, non sul cammino.
  assert.ok(I.aggiustamentoMeteo({ temperatura: 36 }, 0, 600) > 0);
});

test("l'ora di punta penalizza i cambi in più", () => {
  const otto = new Date(2026, 10, 28, 8, 0, 0);
  assert.ok(I.aggiustamentoOra(otto, 2, 300) > I.aggiustamentoOra(otto, 1, 300));
  const tre = new Date(2026, 10, 28, 15, 0, 0);
  assert.equal(I.aggiustamentoOra(tre, 2, 300), 0);
  // Di notte l'attesa lunga costa.
  assert.ok(I.aggiustamentoOra(new Date(2026, 10, 28, 23, 0, 0), 0, 1200) > 0);
});

test('si mostra un solo suggerimento, il più urgente', () => {
  const scelto = I.scegliSuggerimento([
    { tipo: 'N1', testo: 'Il 20 è in ritardo di 4 min' },
    { tipo: 'N2', testo: 'Il 20 passa tra 3 min' }
  ], []);
  assert.equal(scelto.tipo, 'N2');
});

test('un suggerimento ignorato tre volte non torna', () => {
  let ignorati = [];
  for (let i = 0; i < 3; i += 1) ignorati = I.registraIgnorato(ignorati, 'N7');
  const scelto = I.scegliSuggerimento([{ tipo: 'N7', testo: 'Piove' }], ignorati);
  assert.equal(scelto, null);
});

test('con tutti i servizi giù il punteggio resta quello base', () => {
  const base = { tempoTotale: 1200, cambi: 0, metriCammino: 0, tempoAttesa: 0 };
  assert.equal(I.punteggioCombinato(base), 1200);
  assert.equal(I.affidabilitaRealtime([]), null);
  assert.equal(I.affidabilitaRealtime([{ ritardoLive: 0 }]), 1);
  assert.equal(I.affidabilitaRealtime([{ ritardoLive: 700 }]), 0.2);
  // Un ritardo mancante non è uno zero: non deve diventare «in orario».
  assert.equal(I.affidabilitaRealtime([{ ritardoLive: null }]), null);
  assert.equal(I.affidabilitaRealtime([{ ritardoLive: 0 }, { ritardoLive: null }]), 1);
});

test('l\'affidabilità è completa solo se tutte le corse bus hanno un ritardo', () => {
  const unaSola = I.coperturaRealtime([
    { tipo: 3, ritardoLive: 0 },
    { tipo: 3, ritardoLive: null },
    { tipo: 1, ritardoLive: null }
  ]);
  assert.equal(unaSola.corse, 2);
  assert.equal(unaSola.note, 1);
  assert.equal(unaSola.treni, true);
  assert.equal(unaSola.completa, false);
  // Il treno non conta: non ha un feed live e renderebbe parziale ogni viaggio.
  const conTreno = I.coperturaRealtime([
    { tipo: 3, ritardoLive: 60 },
    { tipo: 2, ritardoLive: null }
  ]);
  assert.equal(conTreno.corse, 1);
  assert.equal(conTreno.treni, true);
  assert.equal(conTreno.completa, true);
  const soloTreno = I.coperturaRealtime([{ tipo: 1, ritardoLive: null }]);
  assert.equal(soloTreno.completa, false);
  assert.equal(soloTreno.treni, true);
  const soloBus = I.coperturaRealtime([{ tipo: 3, ritardoLive: 60 }]);
  assert.equal(soloBus.treni, false);
  assert.equal(soloBus.completa, true);
});

test('una corsa troppo in ritardo si scarta, una in orario no', () => {
  assert.equal(I.corsaDaScartare({ ritardoLive: 960 }), true);
  assert.equal(I.corsaDaScartare({ ritardoLive: 120 }), false);
  assert.equal(I.corsaDaScartare({ nonGestita: true }), true);
  assert.equal(I.corsaDaScartare(null), false);
});

test('i festivi sono quelli veri, non tutti i giorni', () => {
  assert.equal(I.festivo(new Date(2026, 11, 25)), true);
  assert.equal(I.festivo(new Date(2026, 11, 24)), false);
  assert.equal(I.festivo('2026-04-06'), true);
});

test('un evento chiude la fermata e il percorso la evita', () => {
  const eventi = [{
    data: '2026-11-28',
    ora_inizio: '18:00',
    ora_fine: '23:00',
    linee_deviate: ['20'],
    fermate_chiuse: ['BO0042']
  }];
  const quando = new Date(2026, 10, 28, 20, 0, 0);
  assert.equal(I.disturboAttivo(eventi, quando).length, 1);
  assert.equal(I.disturboAttivo(eventi, new Date(2026, 10, 28, 9, 0, 0)).length, 0);
  const colpiti = I.toccaDisturbo([{ linea: '20', fermataId: 'BO0042' }], I.disturboAttivo(eventi, quando));
  assert.equal(colpiti.length, 2);
});

test('la spiegazione ha al massimo due motivi e solo se cambia qualcosa', () => {
  const testo = I.spiegaConfronto(
    { cambi: 1, metriCammino: 100, arrivo: 3000 },
    { cambi: 2, metriCammino: 900, arrivo: 3600 }
  );
  assert.ok(testo.split(' · ').length <= 2);
  assert.equal(I.spiegaConfronto({ cambi: 1 }, { cambi: 1 }), '');
});
