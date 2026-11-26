# Changelog

Tutte le modifiche importanti dell'app. Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [Non pubblicato]

- Barra superiore ridisegnata: niente banda bianca, i comandi galleggiano sulla mappa. In alto a sinistra c'è **un solo tasto**: hamburger nella schermata iniziale, freccia indietro quando c'è un percorso o gli orari di una fermata aperti. La freccia risale di un gradino (pannello aperto → ridotto → home) senza perdere la tratta.

- Le impostazioni tecniche (linee da evitare, relay HelloBus, log errori) non stanno più nel menu: si aprono scrivendo **«admin»** nella ricerca, sia da «Dove parti?» sia da «Dove vai?». Chi non lo sa non le trova, e il menu resta corto.

- Mappa: interruttore **Zone tariffarie** nel menu. Ogni zona è un'area appena colorata (rossa la 500, grigie le altre) e toccandola si legge il suo nome e se è urbana, neutra o extraurbana. I confini ufficiali TPER non sono pubblicati: l'area è l'involucro delle fermate della zona, quindi è una stima dichiarata.

### Aggiunto
- Linee sulla mappa in stile metropolitana: bordo bianco sotto il colore, spessore uniforme che cresce con lo zoom, angoli arrotondati, geometria semplificata (~8 m) per togliere il tremolio, fermate come cerchi bianchi con anello scuro quando le linee sono visibili.
- `privacy.html`: informativa statica (dati locali, posizione, servizi esterni, conservazione, diritti).
- Voce **Cancella tutti i dati** nel menu: svuota `localStorage`, cache e service worker, poi riavvia l'app.
- Link a Privacy e alla nota «App non ufficiale TPER» nel piede del menu.
- `FUNZIONI.md`: indice completo delle 361 funzioni, verificato contro il codice.
- Segnalazione del controllore per linea, condivisa tra dispositivi (Worker + D1 in `controllori-api/`).
- Meteo attuale da Open-Meteo, usato solo nel criterio «ottimizzato».
- «Linee da evitare» nel menu, applicate a tutte le ricerche.
- Ritardi live su tutte le tappe, con cambio «a rischio» e corsa «persa».

### Cambiato
- Pannello orari: **tutte** le corse che restano nella giornata, tempo reale e programmate, in un unico elenco ordinato per quanto manca. Entro 50 minuti si legge «tra N min» (e «ora» se sta passando), oltre compare l'orario. Le corse si filtrano con le chip delle linee.
- Righe compatte come un tabellone: ora, badge colorato della linea, destinazione. Tolti pallini e linea verticale della timeline; l'etichetta resta solo per le corse reali (LIVE).
- La stessa corsa arrivata da HelloBus (`13A`) e dal GTFS (`13`) non compare due volte e mostra la direzione.
- `euro(0)` restituisce «Incluso»: «0,00 €» non compare più da nessuna parte.
- `senzaDoppioni` distingue le fermate omonime di comuni diversi (chiave nome + comune).
- CSP: aggiunta l'origine del relay `proxy.corsfix.com`, che il browser stava bloccando (fallback su un altro relay).
- Service worker: installazione con `Promise.allSettled` (un asset mancante non blocca più tutto), `cache.put` solo per risposte `ok`, navigazioni sconosciute in rete prima del fallback offline, potatura dei file non più presenti.

### Corretto
- Dopo mezzanotte la modalità «adesso» riparte dal giorno corrente: prima il pannello orari restava sulla data di ieri, quindi vuoto.
- Un elenco partenze vuoto non viene più messo in cache: se gli orari non erano ancora caricati, la giornata restava vuota per tutta la sessione.
- Margine di 5 minuti su «arriva entro», con avviso «poco margine» sotto i 2.
- Buffer di cambio: 180 s bus-bus (30 s se è la stessa linea), 240 s con treno, 360 s treno-treno.
- Badge «tempi a piedi stimati» quando la geometria OSRM non è ancora arrivata.

## [1.0.0]

Prima versione pubblica: ricerca fermate e indirizzi, percorsi con cambi e criterio veloce/ottimizzato, orari in tempo reale, navigazione guidata con GPS, preferiti con avvisi, biglietto e abbonamento, PWA installabile e funzionante offline.
