# Changelog

Tutte le modifiche importanti dell'app. Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [Non pubblicato]

- **Notifiche locali**: l'avviso a 2 minuti di una corsa negli orari ora invia davvero una notifica di sistema, una sola volta per fermata, linea, ora e giorno; la voce **Notifiche** nel menu chiede il permesso e mostra se sono attive o bloccate. In navigazione, a schermo spento, arriva anche l'avviso «scendi alla prossima». Restano locali: con l'app completamente chiusa non arrivano, perché manca un server push.
- **Linee SFM**: aggiunte S1A (Porretta–Bologna–Pianoro), S1B (Bologna–San Benedetto), S2B (Bologna–Portomaggiore), S3 (Bologna–Poggio Rusco), S4A (Bologna–Ferrara), S4B (Bologna–Imola) e S5 (Bologna–Modena) dagli orari ufficiali SFMBO, con 534 corse, 36 nuove stazioni e geometrie dedicate. Le corse sono validate su sequenza e orari monotoni; la S2B, oggi servita da bus sostitutivi, resta una linea bus e non viene spacciata per treno. Il badge del percorso mantiene la sigla SFM invece di ridurla a REG.
- **Marconi Express (MEX)**: aggiunto il people mover Bologna Centrale FS–Lazzaretto–Aeroporto con 3.591 corse dal GTFS ufficiale TPER `gtfsmex`, 3 fermate (`TRN001`, `TRN043`, `TRN044`) e geometria ufficiale. Il badge resta **MEX** (non REG), la tariffa è separata (12,80 € aeroporto–centrale, 2,30 € centrale–Lazzaretto) e non viene coperta dall'abbonamento TPER.
- **Nuovo marchio e icone animate**: logo a “M” di transito con una fermata centrale, al posto del bus nei cerchi. Le icone hanno micro-animazioni ispirate ad animate-ui (menu che diventa X, frecce, scambio, campanella, refresh), disattivate con `prefers-reduced-motion`.
- **Pulizia delle vecchie preferenze dei criteri**: all'avvio l'app rimuove da `localStorage` `tperzc_criterio_v1`, `tperzc_criterio_default_v1`, `tperzc_criterio_scelte_v1`, `tperzc_criterio_proposto_v1` e le varianti senza prefisso. Non sono più usate e non compaiono nella cookie policy; la pulizia non tocca le preferenze attuali.
- **Overlay delle zone a bersaglio**: l'Area Urbana di Bologna non è più una serie di macchie separate. La 500 è un disco centrale, le neutre 501–509 una corona continua divisa in spicchi nella direzione delle loro fermate; le extraurbane restano cerchi locali. I raggruppamenti delle fermate si nascondono mentre l'overlay è acceso, così le aree e i numeri restano leggibili.
- **Ricerca luoghi e indirizzi come Maps**: prima si cerca in un riquadro attorno a partenza, GPS o centro mappa e solo se non c'è nulla si allarga all'area TPER (Bologna, Porretta, Vignola, Imola, Ferrara). I risultati sono deduplicati, riordinati per pertinenza e distanza e mostrano metri o chilometri; per le categorie («farmacia», «bar», «parco») vincono i più vicini. Le fermate che contengono la parola ma stanno dall'altra parte della regione non occupano più i primi posti. Cache indirizzi portata a `v2`.
- **S1 Porretta**: 56 corse (23 andata, 33 ritorno) da Bologna C.le a Porretta Terme, importate dal PDF ufficiale TPER valido dal 14 giugno al 12 dicembre 2026. La corsa con nota 7 (sospesa nei festivi e prefestivi) resta fuori; le geometrie seguono i binari OpenStreetMap.
- **Un solo percorso consigliato**: niente più tasti «Veloce»/«Ottimizzato» né righe che spiegano il confronto. L'algoritmo sceglie da sé, entro il 15% del tempo minimo, la soluzione con meno cambi, cammino e attese; le altre restano sotto «Altre soluzioni».
- **Meteo silenzioso**: pioggia, neve e vento forte continuano a far pesare di più i tratti a piedi, ma la scheda non lo scrive più.
- **Ricerca per linea**: scrivendo «20» nella ricerca compaiono le linee oltre alle fermate; la scheda della linea mostra il tracciato sulla mappa, le direzioni, l'elenco delle fermate, l'ultima corsa e il ritardo tipico osservato.
- **Direzioni della linea**: scegliendo una direzione dalla tendina cambiano davvero fermate e tracciato; prima il confronto tra l'ID numerico del capolinea e il valore testuale della tendina riportava sempre la prima direzione.
- **Nomi delle fermate**: l'elenco e le linee mostrano solo il nome specifico («Casalecchio Marconi» invece di «Casalecchio di Reno - Casalecchio Marconi»); il comune compare nella riga dell'indirizzo, per esempio «Casalecchio di Reno · Via Marconi Fr 40».
- **Ultima corsa** segnalata nelle opzioni di percorso quando la tappa usa l'ultima partenza utile della giornata.
- **Avviso «scendi alla prossima»**: vibrazione e testo una fermata (circa 250 m) prima della discesa, una volta sola.
- **Viaggio condivisibile**: partenza, destinazione, giorno, ora e linea stanno nell'URL e vengono letti all'avvio.
- **Fermate fissate**: fino a tre fermate in home con il prossimo passaggio, fissabili dagli orari; Casa e Lavoro restano separati.
- **Puntualità tipica**: dopo almeno cinque osservazioni, la linea mostra «di solito +N min», solo dai viaggi visti da questo dispositivo.
- **Ricerca tollerante**: abbreviazioni (`v.le`, `p.za`, `staz.`) e un errore di battitura non lasciano più a secco la ricerca delle fermate.
- **Cache locale degli indirizzi** Nominatim (sette giorni, massimo quaranta voci) e **copia del log errori** dal pannello admin.
- **Avvio più leggero**: non si riscrivono più fermate e linee in `localStorage` a ogni apertura se il dataset non è cambiato; il tempo di caricamento viene misurato e incluso nel log copiato.
- **Tastiera**: frecce su e giù nei suggerimenti, Invio sul primo risultato, focus visibile.
- **Tasto indietro del browser**: ogni scelta di fermata, linea o orari crea una voce di cronologia con i parametri del viaggio; l'indietro ripristina la ricerca precedente (solo partenza, viaggio prima, linea, orari) e non si limita a riscrivere l'URL. Anche la freccia dell'app usa la stessa cronologia.
- **Tracciato della linea** del colore ufficiale della linea (lo stesso dei percorsi, scurito solo se troppo chiaro) e disegnato appena la mappa ha lo stile, anche se al momento dell'apertura non era ancora pronta: si riprova finché la vista linea resta aperta, senza perdersi il percorso.
- **Direzione della linea** in una tendina a tutta larghezza invece di una fila di chip da scorrere: con nove capolinea la scelta resta un tocco solo, anche da tastiera.
- **Home più pulita**: la partenza è la posizione attuale, richiesta in automatico all'apertura (se il permesso è negato restano le fermate); il viaggio precedente non viene riaperto; il pin rosso della partenza compare solo quando c'è una destinazione e tornando in home il tracciato sparisce, così restano solo le fermate. La posizione GPS non finisce mai negli URL condivisi.
- **Pin delle fermate** rotondi con ombra morbida al posto della goccia con la punta: stesso linguaggio del resto dell'interfaccia, senza linee rigide.
- **Flusso più lineare**: il tasto indietro non passa più dal pannello ridotto (dettaglio → riepilogo → home) e annulla anche una scelta incompleta; dagli orari di una fermata si può partire o impostarla come destinazione senza tornare alla home.
- **Menu**: la voce «La mia posizione» imposta davvero la posizione come partenza; un preferito impostato apre subito il percorso e la matita lo cambia; «Percorso attuale» sostituisce l'etichetta fuorviante «Percorsi recenti».
- **Durate oltre l'ora** scritte come «1h» o «2h e 35min» nel riepilogo, nelle alternative e nei singoli tratti, invece di «95 min».
- **Orari di una fermata**: toccando una corsa si apre la pagina della sua linea; il chevron a destra conserva dettagli della corsa e avviso a due minuti.
- **Ritorno in un tocco**: il pulsante di inversione scambia partenza e destinazione e imposta la partenza all'arrivo previsto, con un minuto di margine.
- **Viaggi salvati**: fino a cinque tratte complete, con ora e tipo di ricerca, riapribili dal menu e ricalcolate sul giorno corrente.
- **Luoghi condivisi**: Web Share Target per ricevere un luogo o un link da Maps e da altre app, con lettura delle coordinate e geocodifica di riserva.
- **Ritardo che rompe il viaggio**: quando HelloBus segnala un cambio perso, un pulsante ricalcola dalla posizione attuale o dalla fermata del cambio, evitando la linea non raggiungibile; la partenza originale resta solo se non c'è né posizione né fermata di cambio.
- **Nessun viaggio**: al posto dell'orario fisso «domani alle 08:00» si cerca la prima corsa utile nelle prossime 24 ore.
- **Tabellone della fermata**: le corse live che HelloBus anticipa o posticipa rispetto al GTFS prendono il capolinea dalla corsa programmata più vicina della stessa linea, invece di mostrare «Bus 5554». Tolto il pulsante «Fissa» dall'intestazione degli orari.
- **Avviso «scendi alla prossima»** azzerato a ogni nuova navigazione: la vibrazione si ripete anche se la fermata di discesa è la stessa del viaggio precedente.
- **Scorciatoie nel manifest** per Casa e Lavoro.
- Non implementati e dichiarati come limiti: notifiche push ad app completamente chiusa (servono chiavi VAPID, un deploy del Worker e la crittografia Web Push) e filtro «fermate accessibili» (il dataset non espone `wheelchair_boarding`).

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
