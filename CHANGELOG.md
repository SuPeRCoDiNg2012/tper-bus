# Changelog

Tutte le modifiche importanti dell'app. Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [Non pubblicato]

### Aggiunto
- `privacy.html`: informativa statica (dati locali, posizione, servizi esterni, conservazione, diritti).
- Voce **Cancella tutti i dati** nel menu: svuota `localStorage`, cache e service worker, poi riavvia l'app.
- Link a Privacy e alla nota «App non ufficiale TPER» nel piede del menu.
- `FUNZIONI.md`: indice completo delle 361 funzioni, verificato contro il codice.
- Segnalazione del controllore per linea, condivisa tra dispositivi (Worker + D1 in `controllori-api/`).
- Meteo attuale da Open-Meteo, usato solo nel criterio «ottimizzato».
- «Linee da evitare» nel menu, applicate a tutte le ricerche.
- Ritardi live su tutte le tappe, con cambio «a rischio» e corsa «persa».

### Cambiato
- `euro(0)` restituisce «Incluso»: «0,00 €» non compare più da nessuna parte.
- `senzaDoppioni` distingue le fermate omonime di comuni diversi (chiave nome + comune).
- Service worker: installazione con `Promise.allSettled` (un asset mancante non blocca più tutto), `cache.put` solo per risposte `ok`, navigazioni sconosciute in rete prima del fallback offline, potatura dei file non più presenti.

### Corretto
- Margine di 5 minuti su «arriva entro», con avviso «poco margine» sotto i 2.
- Buffer di cambio: 120 s bus-bus, 240 s con treno, 360 s treno-treno.
- Badge «tempi a piedi stimati» quando la geometria OSRM non è ancora arrivata.

## [1.0.0]

Prima versione pubblica: ricerca fermate e indirizzi, percorsi con cambi e criterio veloce/ottimizzato, orari in tempo reale, navigazione guidata con GPS, preferiti con avvisi, biglietto e abbonamento, PWA installabile e funzionante offline.
