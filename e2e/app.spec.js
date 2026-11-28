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

test('fermata e corsa hanno la segnalazione già compilata', async ({ page }) => {
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  const linkFermata = page.locator('#vista-orari a.link-segnala');
  await expect(linkFermata).toBeVisible();
  const hrefFermata = decodeURIComponent(await linkFermata.getAttribute('href'));
  expect(hrefFermata).toContain('github.com/SuPeRCoDiNg2012/tper-bus/issues/new');
  expect(hrefFermata).toContain('palina 100');
  expect(hrefFermata).toContain('| Giorno |');

  await page.locator('#vista-orari .arrivo-chevron').first().click();
  const linkCorsa = page.locator('#vista-orari .arrivo-dettaglio a.link-mini');
  await expect(linkCorsa).toBeVisible();
  const hrefCorsa = decodeURIComponent(await linkCorsa.getAttribute('href'));
  expect(hrefCorsa).toContain('| Linea |');
  expect(hrefCorsa).toContain('| Ora |');
  expect(hrefCorsa).toContain('| Dati aggiornati al |');
});

test('il tema scuro resta dopo il ricaricamento', async ({ page }) => {
  await senzaRete(page);
  await page.goto('/');
  await chiudiOnboarding(page);
  await page.locator('#btn-menu').click();
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
  await page.locator('#btn-menu').click();
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
  await page.locator('#btn-menu').click();
  await page.locator('label[for="menu-testo"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-testo', 'grande');
  await page.goto('/?fermata=100');
  await expect(page.locator('html')).toHaveAttribute('data-testo', 'grande');
  await expect(riga).toBeVisible();
  await expect.poll(altezzaRiga).toBeGreaterThan(altezzaPrima * 1.05);
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
  await expect(drawer).toContainText('Notifications');
  await expect(drawer).toContainText('Dark theme');
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
  await page.locator('#btn-menu').click();
  await expect(page.locator('#drawer')).toContainText('Privacy policy');
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
