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

test('nessun errore JavaScript sulle schermate principali', async ({ page }) => {
  const errori = [];
  page.on('pageerror', (errore) => errori.push(String((errore && errore.message) || errore)));
  await senzaRete(page, { hellobus: true });
  await page.goto('/?fermata=100');
  await expect(page.locator('#vista-orari')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(errori).toEqual([]);
});
