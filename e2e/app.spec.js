'use strict';

/* Test end-to-end di Muovi Bologna.
 *
 * Scelta di fondo: la rete esterna è chiusa. Mappa, HelloBus e Nominatim
 * rispondono solo se li intercettiamo noi, altrimenti la richiesta viene
 * annullata. Un test che dipende dal wifi di turno non dice se l'app è rotta.
 */

const { test, expect } = require('@playwright/test');

const ORIGINE = 'http://127.0.0.1:8124';

function oraTra(minuti) {
  const d = new Date(Date.now() + minuti * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Chromium nei test ha la lingua inglese, quindi l'app partirebbe tradotta:
// qui la lingua è fissata, tranne nel test che verifica proprio quello.
async function inItaliano(page) {
  // L'onboarding è già stato visto: senza, il dialogo copre la mappa per i
  // primi secondi e intercetta i clic destinati ai comandi sotto.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tperzc_lingua_v1', 'it');
      localStorage.setItem('tperzc_onboarding_visto_v1', '1');
    } catch (errore) { /* nulla */ }
  });
}

async function senzaRete(page, opzioni) {
  if (!opzioni || !opzioni.inglese) await inItaliano(page);
  const conHellobus = !!(opzioni && opzioni.hellobus);
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGINE)) return route.continue();
    if (conHellobus && (url.includes('hellobus') || url.includes('tper.it'))) {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: 'TperHellobus: 20 DaSatellite ' + oraTra(4) + ' (Bus 4242), 21 Previsto ' + oraTra(11)
      });
    }
    return route.abort();
  });
}

// L'onboarding è un dialogo a tutto schermo: se resta aperto intercetta i clic.
// Il primo test lo lascia comparire di proposito, quindi qui si aspetta che
// arrivi invece di guardare una volta sola.
async function chiudiOnboarding(page) {
  const onboarding = page.locator('#onboarding');
  try {
    await onboarding.waitFor({ state: 'visible', timeout: 3000 });
  } catch (errore) {
    return;
  }
  const inizia = page.getByRole('button', { name: /Inizia|Start/ });
  await inizia.first().click();
  await expect(onboarding).toBeHidden();
}

// Le impostazioni non stanno più nel menu: un tasto solo le apre.
async function apriImpostazioni(page) {
  // Con la freccia indietro a sinistra il menu si apre dal tasto a destra.
  const torna = await page.locator('#barra').evaluate((el) => el.classList.contains('torna'));
  await page.locator(torna ? '#btn-menu-destra' : '#btn-menu').click();
  await page.locator('#menu-impostazioni').click();
  await expect(page.locator('#impostazioni')).toBeVisible();
}

test('il primo avvio mostra una sola schermata e «Inizia» la chiude', async ({ page }) => {
  await senzaRete(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('tperzc_lingua_v1', 'it');
    } catch (errore) { /* storage negato */ }
  });
  await page.goto('/');
  await expect(page.locator('#onboarding')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.ob-slide')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inizia' }).click();
  await expect(page.locator('#onboarding')).toBeHidden();
});

test('gli orari di una fermata mostrano le corse, senza etichette ripetute', async ({ page }) => {
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  const vista = page.locator('#vista-orari');
  await expect(vista).toBeVisible();
  await expect(vista).toContainText('Palina 100');
  await expect(vista.locator('.arrivo-item').first()).toBeVisible();
  // Il test che conta: le righe non ripetono più «Orario programmato».
  await expect(vista).not.toContainText('Orario programmato');
  await expect(vista).not.toContainText('Direzione non disponibile');
});

test('la segnalazione si fa dalle impostazioni, con la fermata già dentro', async ({ page }) => {
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  // Nessun collegamento sparso negli arrivi: la segnalazione vive nelle impostazioni.
  await expect(page.locator('#vista-orari a.link-segnala')).toHaveCount(0);
  await expect(page.locator('#vista-orari .btn-schermo')).toHaveCount(0);
  // La fermata aperta entra nella segnalazione senza doverla riscrivere.
  await apriImpostazioni(page);
  const link = page.locator('#menu-segnala');
  await expect(link).toBeVisible();
  const href = decodeURIComponent(await link.getAttribute('href'));
  expect(href).toContain('github.com/SuPeRCoDiNg2012/tper-bus/issues/new');
  expect(href).toContain('palina 100');
  expect(href).toContain('| Giorno |');
});

test('il tema scuro resta dopo il ricaricamento', async ({ page }) => {
  await senzaRete(page);
  await page.goto('/');
  await chiudiOnboarding(page);
  await apriImpostazioni(page);
  // Si tocca la riga, non l'input: l'interruttore è un input nascosto per il
  // disegno, e il clic sull'etichetta è quello che farebbe una persona.
  await page.locator('label[for="menu-tema"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'scuro');
  await page.reload();
  await chiudiOnboarding(page);
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'scuro');
});

test('esporta e reimporta i dati locali', async ({ page }) => {
  await senzaRete(page);
  await page.goto('/');
  await chiudiOnboarding(page);
  await apriImpostazioni(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#menu-esporta').click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^muovi-bologna-\d{4}-\d{2}-\d{2}\.json$/);

  page.on('dialog', (finestra) => finestra.accept());
  await page.setInputFiles('#menu-importa', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      app: 'Muovi Bologna',
      versione: 1,
      dati: { tperzc_tema_v1: 'scuro', tperzc_storico_ritardi_v2: '{"20":[3]}' }
    }))
  });
  // Dopo il ripristino l'app si ricarica da sola.
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'scuro', { timeout: 8000 });
});

test('il testo grande ingrandisce il pannello', async ({ page }) => {
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  const riga = page.locator('#vista-orari .arrivo-item').first();
  await expect(riga).toBeVisible();
  // La lista si ridisegna da sola: si legge la riga con una query fresca.
  const altezzaRiga = () => page.evaluate(() => {
    const el = document.querySelector('#vista-orari .arrivo-item');
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  });
  const altezzaPrima = await altezzaRiga();
  // Sugli orari il pulsante in alto torna indietro invece di aprire il menu:
  // l'interruttore si tocca dalla home, poi si torna agli orari.
  await page.goto('/');
  await chiudiOnboarding(page);
  await apriImpostazioni(page);
  // Tre livelli distinti, non più un interruttore acceso/spento.
  await page.selectOption('#menu-testo-livello', 'grande');
  await expect(page.locator('html')).toHaveAttribute('data-testo', 'grande');
  await page.selectOption('#menu-testo-livello', 'molto-grande');
  await expect(page.locator('html')).toHaveAttribute('data-testo', 'molto-grande');
  // L'alto contrasto è uno stato sull'elemento radice, non un foglio a parte.
  await page.locator('label[for="menu-contrasto"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-contrasto', 'alto');
  await page.goto('/?fermata=100');
  await expect(page.locator('html')).toHaveAttribute('data-testo', 'molto-grande');
  await expect(page.locator('html')).toHaveAttribute('data-contrasto', 'alto');
  await expect(riga).toBeVisible();
  await expect.poll(altezzaRiga).toBeGreaterThan(altezzaPrima * 1.05);
});

// Preferiti già impostati: il salvataggio passa dalla ricerca, che ha i suoi
// test; qui conta cosa fa il menu con quello che c'è.
async function conPreferiti(page) {
  await page.addInitScript(() => {
    try {
      // Solo alla prima visita: al ricaricamento i preferiti sono quelli che
      // l'utente ha appena rinominato e spostato.
      if (localStorage.getItem('tperzc_preferiti_v1')) return;
      localStorage.setItem('tperzc_preferiti_v1', JSON.stringify({
        casa: { id: '100', nome: 'Piazza Maggiore', indirizzo: '', lat: 44.4937, lon: 11.343, zona: '500', tipo: 'fermata', genere: 'fermata', categoria: '' },
        lavoro: { id: '200', nome: 'Stazione Centrale', indirizzo: '', lat: 44.5055, lon: 11.3432, zona: '500', tipo: 'fermata', genere: 'fermata', categoria: '' },
        _meta: { nomi: {}, ordine: ['lavoro', 'casa'], extra: [] }
      }));
    } catch (errore) { /* nulla */ }
  });
}

test('un preferito si rinomina e si sposta', async ({ page }) => {
  await senzaRete(page);
  await conPreferiti(page);
  await page.goto('/');
  await chiudiOnboarding(page);
  await page.locator('#btn-menu').click();
  const righe = page.locator('#menu-preferiti .menu-pref-riga');
  // L'ordine salvato è quello scelto: prima il lavoro.
  await expect(righe.first()).toContainText('Lavoro');
  await page.locator('[data-azione="pref-modifica"]').click();
  page.once('dialog', (finestra) => finestra.accept('Ufficio'));
  await page.locator('[data-azione="pref-rinomina"]').first().click();
  await expect(righe.first()).toContainText('Ufficio');
  await page.locator('[data-azione="pref-giu"]').first().click();
  await expect(righe.first()).toContainText('Casa');
  // La scelta resta dopo il ricaricamento, perché sta su localStorage.
  await page.reload();
  await chiudiOnboarding(page);
  await page.locator('#btn-menu').click();
  await expect(page.locator('#menu-preferiti .menu-pref-riga').first()).toContainText('Casa');
  await expect(page.locator('#menu-preferiti')).toContainText('Ufficio');
});

test('il promemoria feriale ricorda ora e preferito', async ({ page }) => {
  await senzaRete(page);
  await conPreferiti(page);
  await page.goto('/');
  await chiudiOnboarding(page);
  await apriImpostazioni(page);
  await page.locator('label[for="menu-feriale"]').click();
  await expect(page.locator('#menu-feriale')).toBeChecked();
  await page.locator('#menu-feriale-ora').fill('07:40');
  await page.locator('#menu-feriale-ora').dispatchEvent('change');
  await page.locator('#menu-feriale-luogo').selectOption('lavoro');
  await expect(page.locator('#menu-feriale-nota')).toContainText('07:40');
  await expect(page.locator('#menu-feriale-nota')).toContainText('Lavoro');
  const salvato = await page.evaluate(() => JSON.parse(localStorage.getItem('tperzc_feriale_v1')));
  expect(salvato.attivo).toBe(true);
  expect(salvato.ora).toBe('07:40');
  expect(salvato.slot).toBe('lavoro');
});

test('con la lingua inglese il menu è tradotto', async ({ page }) => {
  await senzaRete(page, { inglese: true });
  await page.addInitScript(() => {
    try { localStorage.setItem('tperzc_lingua_v1', 'en'); } catch (errore) { /* nulla */ }
  });
  await page.goto('/');
  await chiudiOnboarding(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('#btn-menu').click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Settings');
  // Le voci non essenziali non stanno più nel menu: sono nella schermata
  // impostazioni, dietro quel tasto.
  await expect(drawer).not.toContainText('Dark theme');
  await page.locator('#menu-impostazioni').click();
  const impostazioni = page.locator('#impostazioni');
  await expect(impostazioni).toBeVisible();
  await expect(impostazioni).toContainText('Notifications');
  await expect(impostazioni).toContainText('Dark theme');
  await expect(impostazioni).toContainText('Weekday reminder');
});

test('le pagine legali seguono la lingua scelta', async ({ page }) => {
  await senzaRete(page, { inglese: true });
  // Solo se non c'è già una scelta: così il clic sull'interruttore della
  // pagina, che ricarica, non viene sovrascritto a ogni navigazione.
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem('tperzc_lingua_v1')) localStorage.setItem('tperzc_lingua_v1', 'en');
    } catch (errore) { /* nulla */ }
  });

  const pagine = [
    ['privacy.html', 'Privacy policy'],
    ['termini.html', 'Terms and conditions of use'],
    ['cookie.html', 'Cookie policy'],
    ['note-legali.html', 'Legal notes']
  ];
  for (const [file, titolo] of pagine) {
    await page.goto('/' + file);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.en h1')).toHaveText(titolo);
    await expect(page.locator('.en')).toBeVisible();
    // L'italiano non deve restare visibile accanto all'inglese.
    await expect(page.locator('.it')).toBeHidden();
  }

  // L'interruttore sulla pagina stessa riporta all'italiano.
  await page.locator('[data-lang-switch="it"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('.it h1')).toHaveText('Note legali');
  await expect(page.locator('.it')).toBeVisible();

  // E i link nel menu dell'app sono tradotti.
  await page.evaluate(() => localStorage.setItem('tperzc_lingua_v1', 'en'));
  await page.goto('/');
  await chiudiOnboarding(page);
  await apriImpostazioni(page);
  await expect(page.locator('#impostazioni')).toContainText('Privacy policy');
});

test('nessun errore JavaScript sulle schermate principali', async ({ page }) => {
  const errori = [];
  page.on('pageerror', (errore) => errori.push(String((errore && errore.message) || errore)));
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  await expect(page.locator('#vista-orari')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(errori).toEqual([]);
});

test('la proposta del push arriva alla terza volta la stessa fermata, una volta sola', async ({ page }) => {
  await senzaRete(page);
  const proposta = page.locator('#proposta-push');
  for (let giro = 0; giro < 3; giro += 1) {
    await page.goto('/?fermata=100');
    await expect(page.locator('#vista-orari')).toBeVisible();
  }
  await expect(proposta).toBeVisible({ timeout: 10000 });
  await expect(proposta).toContainText("anche con l'app chiusa");
  await page.locator('#proposta-push-no').click();
  await expect(proposta).toBeHidden();
  // «Non ora» è una risposta: alla quarta apertura non torna.
  await page.goto('/?fermata=100');
  await expect(page.locator('#vista-orari')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(proposta).toBeHidden();
});

// Diritto di accesso e cancellazione: il pannello deve mostrare davvero le
// chiavi scritte nel telefono, non un elenco decorativo.
test('i tuoi dati elenca le chiavi locali e le FAQ si cercano', async ({ page }) => {
  await page.goto('/');
  await chiudiOnboarding(page);
  await page.evaluate(() => localStorage.setItem('tperzc_prova_v1', 'prova'));
  await apriImpostazioni(page);
  await page.locator('#menu-dati').click();
  const pannello = page.locator('#pannello-dati');
  await expect(pannello).toBeVisible();
  await expect(pannello).toContainText('tperzc_prova_v1');
  await expect(page.locator('#dati-cancella')).toBeVisible();
  await pannello.locator('.impostazioni-testa button').click();
  await page.locator('#menu-faq').click();
  await expect(page.locator('#pannello-faq')).toBeVisible();
  await page.locator('#faq-cerca').fill('offline');
  await expect(page.locator('#faq-elenco details:not([hidden])')).toHaveCount(1);
});
