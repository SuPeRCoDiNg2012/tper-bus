# Changelog

Tutte le modifiche importanti dell'app. Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [Non pubblicato]

- **Ricerca per linea**: scrivendo «20» nella ricerca compaiono le linee oltre alle fermate; la scheda della linea mostra il tracciato sulla mappa, le direzioni, l'elenco delle fermate, l'ultima corsa e il ritardo tipico osservato.
- **Ultima corsa** segnalata nelle opzioni di percorso quando la tappa usa l'ultima partenza utile della giornata.
- **Avviso «scendi alla prossima»**: vibrazione e testo una fermata (circa 250 m) prima della discesa, una volta sola.
- **Viaggio condivisibile**: partenza, destinazione, giorno, ora e linea stanno nell'URL e vengono letti all'avvio.
- **Fermate fissate**: fino a tre fermate in home con il prossimo passaggio, fissabili dagli orari; Casa e Lavoro restano separati.
- **Puntualità tipica**: dopo almeno cinque osservazioni, la linea mostra «di solito +N min», solo dai viaggi visti da questo dispositivo.
- **Ricerca tollerante**: abbreviazioni (`v.le`, `p.za`, `staz.`) e un errore di battitura non lasciano più a secco la ricerca delle fermate.
- **Cache locale degli indirizzi** Nominatim (sette giorni, massimo quaranta voci) e **copia del log errori** dal pannello admin.
- **Avvio più leggero**: non si riscrivono più fermate e linee in `localStorage` a ogni apertura se il dataset non è cambiato; il tempo di caricamento viene misurato e incluso nel log copiato.
- **Tastiera**: frecce su e giù nei suggerimenti, Invio sul primo risultato, focus visibile.
- **Scorciatoie nel manifest** per Casa e Lavoro.
- Non implementati e dichiarati come limiti: notifiche push (servono chiavi VAPID, un deploy del Worker e la crittografia Web Push), S1 Porretta (nessun GTFS verificabile con le fermate intermedie) e filtro «fermate accessibili» (il dataset non espone `wheelchair_boarding`).

- Zone tariffarie ridisegnate: le fermate di una zona si dividono prima nei gruppi che stanno davvero vicini, quindi una zona sparsa non diventa più un triangolo lungo mezza provincia che si sovrappone alle altre. Ogni zona ha il suo numero sulla mappa (toccabile anche dove non c'è un'area) e solo quella scelta si riempie e si evidenzia; aree, confini ed etichette compaiono con lo zoom invece di 157 poligoni sovrapposti tutti insieme. Le aree non sono più una coperta di colore: sotto la barra una pillola dice la zona del punto che stai guardando («Zona 500 · urbana») e al tocco apre la sua scheda.

- Pulizia: via le regole CSS della vecchia sezione «Resto della giornata» (`.orari-giorno`, `.ora-riga`, `.ora-lista`, `.orari-passate` e i loro figli). L'azzeramento del filtro per linea non sta più nella funzione che legge gli orari: è passato a `renderLive`, dove si sa quando cambiano fermata o giorno.

- Filtro dell'elenco fermata: le chip usano la **linea base** come la deduplica, quindi «13» tiene anche le 13A e al posto di tre chip 97/97A/97C ne compare una sola, «97».

- Pacchetto legale completo: informativa privacy (art. 13 GDPR), termini e condizioni d'uso, cookie policy con l'elenco delle chiavi locali, note legali con fonti, licenze e marchi. Le pagine condividono `legale.css`, si aprono dal piè del menu e restano consultabili offline. Nessun banner cookie: l'app non usa cookie, solo memoria tecnica esente da consenso.

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
