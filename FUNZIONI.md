# Tutte le funzioni di Muovi Bologna

Indice completo del codice: **368 funzioni** — 292 in `app.js` e 76 negli altri moduli (in `routing.js` cinque sono scritte come costanti interne) — raggruppate per area. Una riga per funzione, nell'ordine in cui compaiono nel file. La colonna «cosa fa» è volutamente di poche parole: serve a ritrovare il punto giusto, non a sostituire la lettura del codice.

Nessun framework e nessun bundler: `index.html` carica gli script con `<script>` normali, `app.js` è l'unico file grande e gli altri moduli sono oggetti globali (`Utilita`, `Tariffe`, `Piedi`, `Routing`, `VistaPercorso`, `Icone`).

---

## utilita.js — 8 funzioni

Colori, contrasto, cache e timeout: roba che non sa niente di bus.

| Funzione | Cosa fa |
| --- | --- |
| `canale(valore)` | Un canale sRGB normalizzato 0–1 (serve a `luminanza`). |
| `luminanza(hex)` | Luminanza relativa di un colore esadecimale. |
| `contrasto(a, b)` | Rapporto di contrasto WCAG fra due colori (1–21). |
| `testoSuColore(sfondo, preferito)` | Sceglie bianco o nero sopra un colore, rispettando il preferito se leggibile. |
| `cacheDaSvuotare(misure, soglia)` | Quali cache sono cresciute oltre la soglia. |
| `deveMostrareInvito(uso, visto, installata)` | L'invito all'installazione arriva al terzo uso e non si ripete. |
| `timeoutPer(tipo)` | Millisecondi di attesa per ogni tipo di richiesta. |
| `semplifica(punti, tolleranza)` | Douglas-Peucker: toglie i vertici inutili da una linea. |

## tariffe.js — 5 funzioni

| Funzione | Cosa fa |
| --- | --- |
| `isZonaUrbana(zona)` | La zona è quella urbana di Bologna? |
| `distanzaKm(a, b)` | Distanza in linea d'aria; `null` se manca una coordinata. |
| `prezzoTreno(km)` | Prezzo del regionale per km (`null` oltre 200 km). |
| `avvisoConfine(fermataExtraurbana)` | Nota quando la fermata scelta esce dalla zona urbana. |
| `calcola(partenza, destinazione, conAbbonamento, opzioni)` | Biglietto o abbonamento per una tratta, con il perché. |

## piedi.js — 5 funzioni

Geometria dei percorsi pedonali presi da OSRM, con validazione.

| Funzione | Cosa fa |
| --- | --- |
| `chiave(da, a)` | Chiave di cache per una coppia di punti. |
| `url(da, a)` | URL OSRM pedonale per la coppia. |
| `geometriaRisposta(dati)` | Estrae le coordinate dalla risposta OSRM. |
| `lunghezza(coordinate)` | Lunghezza in metri di una linea. |
| `valida(coordinate, massimoMetri)` | Scarta geometrie assurde (percorsi di decine di km). |

## routing.js — 32 funzioni

Il motore: orari GTFS, rete, cambi, criteri, tracciati delle linee.

| Funzione | Cosa fa |
| --- | --- |
| `isoDi(data)` | Data in `YYYY-MM-DD` da un oggetto `Date`. |
| `chiaveDi(data)` | Chiave del giorno usata negli indici orari. |
| `carica(urlGz, urlRaw)` | Carica un JSON compresso, con fallback non compresso. |
| `scaricaJSON(urlGz, urlRaw)` | Download e `JSON.parse` con cache in memoria. |
| `scarica(urlGz, urlRaw)` | Download del testo grezzo: prima `.gz`, poi il file intero. |
| `serviziAttivi(chiave)` | Quali servizi GTFS girano in quel giorno. |
| `costruisciRete(chiave)` | Costruisce la rete di un giorno: corse, fermate, indici. |
| `secondiDa(data)` | Secondi dalla mezzanotte di un orario GTFS. |
| `nomeLinea(indiceLinea)` | Nome commerciale della linea da indice. |
| `etichettaTreno(nome)` | `FR`/`IC`/`RV` per i treni veloci, `REG` per gli altri. |
| `pianifica(chiave, origini, destinazioni, oraPartenza, maxCambi, vietate, camminoMax)` | Cuore del calcolo: cammino + corse, fino a N cambi. |
| `tempoDiCambio(fermata, corsa)` | Minuti necessari per cambiare a una fermata. |
| `normalizzaElenco(valore)` | Lista di linee da stringa o array, senza doppioni. |
| `calcola(daId, aId, quando, opzioni)` | API pubblica del motore per una ricerca. |
| `partenzeFermata(id, quando)` | Prossime partenze da una fermata. |
| `calcolaConfronto(daId, aId, quando, opzioni)` | Calcolo più lento per confronto o ripiego. |
| `firmaEsito(e)` | Due soluzioni con la stessa firma sono la stessa proposta. |
| `punteggio(esito)` | Punteggio interno usato per ordinare. |
| `costo(esito, criterio)` | Costo di un esito secondo il criterio scelto. |
| `confronta(pool, criterio)` | Confronto fra due pool di soluzioni. |
| `perTempo(a, b)` | Comparatore: prima chi arriva prima. |
| `perCosto(a, b)` | Comparatore: prima chi costa meno. |
| `valuta(pool, criterio)` | Migliore soluzione di un pool per il criterio. |
| `pianificaQuando(data, ora, origini, destinazioni, maxCambi, vietate, camminoMax)` | Pianifica su una data/ora esplicita. |
| `soluzioni(data, origini, destinazioni, maxCambi, camminoMax, vietateBase)` | Tutte le soluzioni di una ricerca, già filtrate. |
| `raccogli(vietate)` | Soluzioni raccolte girando attorno alle linee vietate. |
| `decodifica(testo)` | Polilinea dei tracciati, decodificata una volta sola. |
| `numero()` | Indice progressivo dei tracciati. |
| `forma(indiceForma)` | Geometria di una forma (il tracciato di una linea). |
| `tratta(indiceForma, da, a, sequenza)` | Pezzo di tracciato fra due fermate. |
| `caricaTracciati(urlGz, urlRaw)` | Carica i tracciati delle linee su richiesta. |
| `impostaCammini(coppie)` | Lunghezze a piedi fra fermate, calcolate una volta. |

## vista-percorso.js — 16 funzioni

Solo HTML: riceve un esito e restituisce stringhe, nessun accesso al DOM.

| Funzione | Cosa fa |
| --- | --- |
| `esc(valore)` | Escape HTML di un valore. |
| `due(valore)` | Numero a due cifre. |
| `hhmm(secondi)` | Secondi dalla mezzanotte in `HH:MM`. |
| `minuti(secondi)` | Durata in minuti leggibili. |
| `cambiTesto(n)` | «diretto» / «1 cambio» / «2 cambi». |
| `controlli(giorno, orario, modo, camminata)` | Comandi data/ora e soglia a piedi. |
| `piediHTML(testo)` | Riga dei tratti a piedi. |
| `navigaHTML()` | Unico ingresso alla navigazione guidata. |
| `modiHTML(e)` | Icone dei mezzi usati, su una riga sola. |
| `ritardoHTML(e, indice)` | Ritardo live di una corsa; sotto i 2 minuti niente. |
| `dettaglioHTML(e, etichetta)` | Itinerario completo di una singola opzione. |
| `opzioneHTML(e, indice, vista, etichetta)` | Riga compatta di un'opzione, si apre al clic. |
| `esito(vista, etichetta)` | Tutta la scheda percorso: righe, dettaglio, criteri. |
| `minutiA(ora, adessoMinuti)` | Minuti a un orario `HH:MM`, circolari sulla mezzanotte. |
| `chiaveLinea(linea)` | Linea base: `13A` e `13` sono la stessa corsa. |
| `arriviUniti(realtime, programmati, adessoMinuti, opzioni)` | Un solo elenco di arrivi: live + programmati, deduplicati e ordinati. |

## icone.js — 1 funzione

| Funzione | Cosa fa |
| --- | --- |
| `svg(nome, dimensione, classe, opzioni)` | Icona SVG inline dal set interno. |

## sw.js — 3 funzioni

| Funzione | Cosa fa |
| --- | --- |
| `versioneCache(nome)` | Versione della cache dal nome del file. |
| `pulisciCacheVecchie()` | Cancella le cache delle versioni precedenti. |
| `potaturaCache()` | Toglie dalla cache statica i file che non esistono più. |

## controllori-api/worker.js — 6 funzioni

Il backend delle segnalazioni (Worker + D1).

| Funzione | Cosa fa |
| --- | --- |
| `cors(origine)` | Origini ammesse; il resto riceve la prima. |
| `risposta(dati, stato, origine)` | JSON con header CORS e `no-store`. |
| `lineaPulita(valore)` | Normalizza e valida il nome della linea. |
| `prepara(env)` | Crea tabella e indici al primo uso. |
| `leggi(env, linee)` | Segnalazioni attive aggregate per linea. |
| `scrivi(env, linea, verso, dispositivo)` | Inserisce una segnalazione, con tetti anti-spam. |

---

# app.js — 292 funzioni

## Stato locale e preferenze — 11

| Funzione | Cosa fa |
| --- | --- |
| `impostaAbbonamento(valore)` | Salva l'abbonamento e ricalcola la scheda biglietto. |
| `leggiCamminata()` | Soglia a piedi scelta dall'utente. |
| `criterioValido(valore)` | Il criterio è fra quelli ammessi? |
| `criterioPredefinito()` | Criterio di partenza (ottimizzato). |
| `leggiCriterio()` | Criterio salvato, con ripiego sul predefinito. |
| `raggioCamminata()` | Raggio in metri della soglia a piedi. |
| `lineeEvitate()` | Linee da evitare, lette dallo storage. |
| `vietatePer(extra)` | Linee vietate per una ricerca, più l'eccezione. |
| `renderEvitate()` | Disegna l'elenco delle linee evitate nel menu. |
| `impostaLineeEvitate(elenco)` | Salva le linee evitate e aggiorna subito il percorso. |
| `durataMovimento(ms)` | Zero se «riduci movimento» è attivo, altrimenti `ms`. |

## Testo, numeri, colori — 21

| Funzione | Cosa fa |
| --- | --- |
| `esc(valore)` | Escape HTML. |
| `leggi(chiave)` | Lettura da `localStorage` senza eccezioni. |
| `scrivi(chiave, valore)` | Scrittura su `localStorage` senza eccezioni. |
| `leggiJSON(chiave)` | Lettura JSON con `null` se illeggibile. |
| `normalizza(testo)` | Minuscole e accenti tolti, per cercare. |
| `due(valore)` | Numero a due cifre. |
| `euro(valore)` | Prezzo formattato in euro. |
| `tipoEtichetta(tipo)` | Nome del tipo di fermata (bus, treno, …). |
| `iconaTipo(tipo)` | Icona del tipo di fermata. |
| `classeTipo(tipo)` | Classe CSS del tipo di fermata. |
| `debounce(fn, ms)` | Rimanda l'esecuzione fino a pausa nella digitazione. |
| `orarioCorto(data)` | Ora `HH:MM` da un `Date`. |
| `lineaDi(fermata)` | Linee che passano da una fermata. |
| `coloreLinea(nome)` | Colore del badge di una linea. |
| `coloreTracciato(nome)` | Variante più scura per il tracciato in mappa. |
| `coloraTappe(esito)` | Assegna i colori a tutte le tappe dell'esito. |
| `metaFermata(f)` | Testo secondario di una fermata (comune, zona). |
| `eIndirizzo(luogo)` | Il luogo è un indirizzo e non una fermata? |
| `etichettaGenere(luogo)` | Etichetta di genere per un indirizzo. |
| `riferimentoFermata(f)` | Codice palina e riferimento breve. |
| `mostraToast(messaggio, durata)` | Messaggio in una riga dentro il pannello. |

## Rete, avvio, errori — 8

| Funzione | Cosa fa |
| --- | --- |
| `fetchConTimeout(url, ms, opzioni)` | `fetch` con timeout e abort. |
| `segnaleConTimeout(esterno, ms)` | Segnale che scade da solo, unibile a un altro. |
| `aggiornaAvvio(testo)` | Testo della schermata di avvio. |
| `chiudiAvvio()` | Toglie la schermata di avvio. |
| `chiudiAttesaMappa()` | Toglie l'attesa sopra la mappa. |
| `registraErrore(tipo, messaggio, stack)` | Salva un errore nel log in memoria. |
| `collegaErrori()` | Aggancia `error` e `unhandledrejection`. |
| `pulisciCacheSeNecessario()` | Svuota le cache del service worker se cresciute. |

## Fermate e dati — 9

| Funzione | Cosa fa |
| --- | --- |
| `caricaDati()` | Carica fermate e orari e prepara la mappa. |
| `fermataPerId(id)` | Fermata dall'id. |
| `cercaFermate(query)` | Ricerca fermate per nome o codice. |
| `fermatePrincipali()` | Fermate usate per i suggerimenti iniziali. |
| `distanzaMetri(a, b)` | Distanza in metri fra due punti. |
| `fermateVicine(lat, lon, quantita, escludiId)` | Le N fermate più vicine. |
| `senzaDoppioni(elenco)` | Una fermata sola per nome (i due pali). |
| `recenti()` | Fermate cercate di recente. |
| `aggiungiRecente(f)` | Aggiunge una fermata ai recenti. |

## Mappa — 18

| Funzione | Cosa fa |
| --- | --- |
| `creaPin(ruolo)` | Immagine del pin per partenza, arrivo, mezzo. |
| `initMappa()` | Crea la mappa MapLibre e i livelli base. |
| `aggiornaMarker()` | Aggiorna i pin di partenza e arrivo. |
| `inquadra(animato)` | Inquadra i punti di interesse sulla mappa. |
| `nascondiPoiTransito()` | Nasconde i punti di interesse durante il viaggio. |
| `aggiungiLivelliPercorso()` | Aggiunge i livelli del percorso alla mappa. |
| `aggiornaVisibilitaFermate()` | Mostra o nasconde le fermate in base allo stato. |
| `aggiornaFermateMappa()` | Simboli delle 9.600 fermate, nome solo ad alta zoom. |
| `caricaFormeLinee()` | Carica i tracciati delle linee quando servono. |
| `decodificaPolilinea(testo)` | Polilinea `[lat, lon]` come vuole GeoJSON. |
| `mostraLineeTutte(attivo)` | Mostra tutte le linee sulla mappa. |
| `immaginePinFermata(treno)` | Pin della fermata, variante scura per i treni. |
| `creaLivelliPercorso()` | Livelli e sorgenti del percorso. |
| `immagineFreccia()` | Freccia disegnata su canvas e ruotata da MapLibre. |
| `segmento(modo, coordinate, ufficiale, colore)` | Feature di un tratto di percorso. |
| `nodo(ruolo, coordinate)` | Feature di un nodo (partenza, arrivo, cambio). |
| `coordinateFermata(id)` | Coordinate di una fermata dall'id. |
| `proiettaSuLinea(punto, linea)` | Punto più vicino su una linea, con distanza. |

## Piedi e tracciato — 13

| Funzione | Cosa fa |
| --- | --- |
| `piediCaricati()` | Geometrie pedonali già scaricate. |
| `piediSalvati()` | Geometrie pedonali lette dalla cache locale. |
| `geometriaPiedi(da, a)` | Geometria pedonale in cache, se c'è. |
| `accodaPiedi(chiave, esegui)` | Mette una richiesta OSRM in coda (max 2). |
| `svuotaCodaPiedi()` | Fa partire la coda delle richieste pedonali. |
| `chiediPiedi(da, a)` | Chiede il percorso a piedi e ridisegna. |
| `scaricaPiedi(da, a, chiave)` | Scarica la geometria pedonale da OSRM. |
| `segmentoPiedi(da, a)` | Segmento diritto provvisorio, poi quello vero. |
| `distanzaTra(a, b)` | Distanza in metri fra due coordinate. |
| `estendiAgliEstremi(linea, da, a)` | Allunga un tracciato fino ai due estremi. |
| `geometrieUfficiali(tappe)` | Tracciati ufficiali delle corse dell'itinerario. |
| `disegnaTracciato()` | Ridisegna strade, corse e tratti a piedi. |
| `inquadraPercorso(durata)` | Inquadra il percorso lasciando spazio al pannello. |

## Navigazione con GPS — 24

| Funzione | Cosa fa |
| --- | --- |
| `azzeraNavigazione()` | Azzera lo stato della navigazione. |
| `accendiSveglia()` | Tiene lo schermo acceso durante la navigazione. |
| `spegniSveglia()` | Rilascia il blocco dello schermo. |
| `scriviTesto(id, valore)` | Scrive testo solo se è cambiato (screen reader). |
| `coordinataDi(luogo)` | Coordinate di una fermata o di un indirizzo. |
| `distanzaInMetri(punto, coordinate)` | Distanza in metri punto–coordinate. |
| `metriTesto(metri)` | Distanza leggibile («80 m», «1,2 km»). |
| `passiNavigazione()` | Passi della navigazione dal percorso già calcolato. |
| `arrivoPrevisto(passi)` | Orario di arrivo stimato dai passi. |
| `creaMarkerUtente()` | Marker della posizione e cono di direzione. |
| `cerchioPrecisione(lat, lon, raggio)` | Cerchio dell'accuratezza GPS. |
| `mostraPosizioneUtente(posizione)` | Aggiorna marker e cerchio della posizione. |
| `avviaGps()` | Attiva il GPS ad alta precisione. |
| `menuPunto(latlng)` | Menu contestuale su un punto della mappa. |
| `aggiornaNavFollow()` | Segue l'utente o resta libero? |
| `inquadraNavigazione(punto, coords)` | Inquadra la posizione, mappa a nord. |
| `centraNavigazione()` | Recentra sulla posizione dell'utente. |
| `segmentiProgresso()` | Quanto percorso è già alle spalle, per segmenti. |
| `disegnaNavigazione()` | Ridisegna il percorso con l'avanzamento. |
| `avanzaPassi(punto)` | Fa avanzare i passi della navigazione. |
| `aggiornaNavigazione(posizione)` | Un fix GPS: stato, passo corrente, voce. |
| `erroreNavigazione(errore)` | Messaggio d'errore del GPS. |
| `avviaNavigazione()` | Prepara e avvia la navigazione guidata. |
| `fermaNavigazione(silenzioso)` | Chiude la navigazione e ripristina la vista. |

## Ricerca luoghi — 28

| Funzione | Cosa fa |
| --- | --- |
| `motivoVoce(f, titolo, indice)` | Perché una fermata viene suggerita. |
| `prefissoComune(nome)` | Toglie il comune dai nomi uguali in comuni diversi. |
| `nomiCompatti(items)` | Nomi brevi senza prefissi ripetuti. |
| `voceHTML(f, ruolo, motivo, rimuovi, nome)` | Riga di un suggerimento. |
| `gruppiSuggerimenti(campo)` | Raggruppa i suggerimenti (recenti, vicini, …). |
| `gruppiFermate(query)` | Gruppi di fermate per una query. |
| `nomeNominatim(voce)` | Nome leggibile da un risultato Nominatim. |
| `genereNominatim(voce)` | Genere di un indirizzo Nominatim. |
| `categoriaNominatim(voce)` | Categoria di un indirizzo Nominatim. |
| `luogoHTML(luogo, ruolo)` | Riga di un luogo scelto. |
| `skeletonRighe(quante)` | Righe grigie di attesa. |
| `chipSuggerimento(testo)` | Chip di suggerimento rapido. |
| `disegnaSuggerimenti()` | Disegna l'elenco dei suggerimenti. |
| `chiediIndirizzi(testo, token)` | Interroga Nominatim, scartando risposte vecchie. |
| `cercaIndirizzi(testo)` | Avvia la ricerca indirizzi con debounce. |
| `apriCerca(ruolo)` | Apre la ricerca a schermo intero. |
| `apriSuggerimenti(campo, query)` | Apre i suggerimenti per un campo. |
| `chiudiOverlay()` | Chiude l'overlay di ricerca. |
| `aggiornaPulisci()` | Mostra o nasconde la X di pulizia. |
| `impostaInput(ruolo)` | Riempie il campo con il luogo scelto. |
| `selezionaFermata(ruolo, f)` | Sceglie una fermata come partenza o arrivo. |
| `luogoSalvato(luogo)` | Forma salvabile di un luogo (id o coordinate). |
| `luogoRipristinato(salvato)` | Ricostruisce un luogo salvato. |
| `salvaTratta()` | Salva partenza e arrivo per il riavvio. |
| `ripristinaTratta()` | Ripristina l'ultima tratta usata. |
| `quandoEtichetta()` | Testo del pulsante data/ora. |
| `rigaCampoHTML(ruolo)` | Riga di un campo (partenza o arrivo). |
| `pannelloQuandoHTML()` | Pannello data e ora. |

## Preferiti, avvisi, onboarding — 19

| Funzione | Cosa fa |
| --- | --- |
| `preferitiSalvati()` | Preferiti letti dallo storage. |
| `preferitiValidi()` | Preferiti che si risolvono ancora. |
| `salvaPreferito(slot, luogo)` | Salva un preferito in uno slot. |
| `renderPreferiti()` | Disegna la griglia dei preferiti. |
| `avvisiSalvati()` | Avvisi attivi letti dallo storage. |
| `avvisoAttivo(slot)` | Lo slot ha un avviso attivo? |
| `scriviAvviso(slot, attivo)` | Salva lo stato dell'avviso. |
| `mostraNotifica(titolo, corpo, fermataId)` | Notifica di sistema o messaggio interno. |
| `fermataPerAvviso(luogo)` | Fermata più vicina a un luogo preferito. |
| `controllaAvvisi()` | Controlla gli avvisi attivi in background. |
| `avviaAvvisi()` | Avvia il controllo periodico degli avvisi. |
| `alternaAvviso(slot)` | Attiva o spegne l'avviso di un preferito. |
| `apriCercaPreferito(slot)` | Apre la ricerca per impostare un preferito. |
| `azionePreferito(azione, pulsante)` | Gestisce modifica, avviso, rimozione. |
| `scegliLuogo(ruolo, luogo)` | Assegna un luogo al ruolo richiesto. |
| `bloccoVuotoHTML()` | Stato vuoto con tre chip di partenza. |
| `mostraOnboarding()` | Mostra la presentazione iniziale. |
| `aggiornaOnboarding()` | Aggiorna i pallini dell'onboarding. |
| `chiudiOnboarding()` | Chiude l'onboarding e salva il visto. |

## Storia e livelli — 7

| Funzione | Cosa fa |
| --- | --- |
| `segnalaStoriaPercorso()` | Segna nello stato che c'è un percorso aperto. |
| `aggiornaVoceStoria()` | Aggiorna la voce di cronologia per l'indietro. |
| `restaUnLivello()` | C'è ancora qualcosa che l'indietro può chiudere? |
| `indietroBrowser()` | Gestisce il tasto indietro. |
| `indietroLivelli()` | Chiude un livello per volta: overlay, menu, dettaglio. |
| `renderPercorso()` | Unica sorgente del pannello percorso. |
| `collegaCampi()` | Aggancia i due campi di ricerca. |

## Scheda viaggio e biglietto — 22

| Funzione | Cosa fa |
| --- | --- |
| `totaleMinuti(e)` | Durata totale di un esito in minuti. |
| `trattaAPiedi()` | La ricerca è solo cammino (sotto 400 m)? |
| `trenoNellItinerario()` | C'è un treno nell'itinerario? |
| `tariffaCorrente()` | Tariffa da mostrare per la ricerca corrente. |
| `lineeBadge(e)` | Badge delle linee di un esito. |
| `htmlRiepilogo(r)` | Riepilogo in cima alla scheda. |
| `fermataDi(valore)` | Fermata corrispondente a un valore salvato. |
| `piediStimati(e)` | Nota che i tempi a piedi sono stimati. |
| `htmlAlternative()` | Riga delle altre opzioni. |
| `htmlPiediAlternativa()` | Opzione «solo a piedi». |
| `mostraPiedi()` | Mostra il percorso a piedi. |
| `consigliBiglietto(r)` | Consiglio su biglietto o abbonamento. |
| `bigliettoHTML(r)` | Scheda del biglietto. |
| `htmlDettaglio(r)` | Contenitore del dettaglio dell'itinerario. |
| `htmlStatoPercorso()` | Stato del percorso: attesa, errore, vuoto. |
| `listaViciniHTML()` | Fermate vicine come alternative. |
| `aggiornaCardBiglietto()` | Ridisegna la card del biglietto. |
| `collegaRisultato()` | Aggancia i clic dentro il risultato. |
| `aggiornaBarra()` | Barra superiore ridotta a una freccia. |
| `apriMini(f)` | Mini-card di una fermata. |
| `chiudiMini()` | Chiude la mini-card. |
| `apriOrari(f)` | Apre la vista orari di una fermata. |

## Data e ora — 15

| Funzione | Cosa fa |
| --- | --- |
| `dataDaGiorno(valore)` | `Date` da `YYYY-MM-DD`, con controllo di andata e ritorno. |
| `orarioValido(valore)` | L'orario è `HH:MM` valido? |
| `leggiQuando()` | Data, ora e modo (adesso / a un'ora) correnti. |
| `salvaQuando()` | Salva la scelta di data e ora. |
| `oraAdesso()` | Ora corrente in `HH:MM`. |
| `isoDi(d)` | Data in `YYYY-MM-DD`. |
| `oggiISO()` | Data di oggi in `YYYY-MM-DD`. |
| `assicuraQuando()` | In modalità «adesso» l'ora segue il tempo reale. |
| `aggiornaQuando(giorno, orario, adesso)` | Aggiorna data/ora e ricalcola. |
| `impostaModo(modo)` | Passa fra «adesso» e «a un'ora». |
| `secondiDelGiorno(d)` | Secondi dalla mezzanotte. |
| `firmaLinee(e)` | Firma delle linee di un esito. |
| `firmaPercorso(e)` | Firma completa di un esito. |
| `selezionaEsiti(esiti, arrivo)` | Sceglie le opzioni da mostrare, senza doppioni. |
| `respira()` | Cede il controllo al browser fra due ricerche. |

## Calcolo percorsi (UI) — 12

| Funzione | Cosa fa |
| --- | --- |
| `opzionePiedi()` | Costruisce l'opzione solo a piedi. |
| `calcolaOpzioni(da, a, base)` | Opzioni alternative vietando a turno la linea principale. |
| `calcola(quando, vietate)` | Avvia il calcolo principale. |
| `calcolaConCambi(quando)` | Ripiego con più cambi. |
| `aggiungi(esito, quando)` | Aggiunge un esito al pool, senza duplicati. |
| `ordinaPer(elenco, criterio)` | Ordina quello che è già in memoria. |
| `soluzioneConfronto(criterio)` | Soluzione da confrontare con la migliore. |
| `altraSoluzione()` | Passa all'altra soluzione proposta. |
| `spiegaSoluzione(scelta, altra)` | Spiega perché una soluzione è meglio. |
| `htmlCriteri()` | Riga dei criteri (veloce, ottimizzato, …). |
| `htmlBadgePiano()` | Badge del criterio attivo. |
| `htmlSpiegazione()` | Testo che spiega la scelta. |

## Meteo e controllori — 11

| Funzione | Cosa fa |
| --- | --- |
| `caricaMeteo()` | Meteo attuale da Open-Meteo per la zona. |
| `descrizioneMeteo()` | Nota meteo in una riga. |
| `controlloriHTML()` | Righe delle segnalazioni attive del percorso. |
| `htmlSuggerimenti()` | Consigli: corsa scartata, camminare, controllore. |
| `dispositivoId()` | Identificativo casuale del browser. |
| `lineeBusPercorso()` | Linee bus dell'itinerario mostrato. |
| `caricaControllori(forza)` | Scarica le segnalazioni e aggiorna la riga. |
| `segnalaControllore(linea)` | Invia la segnalazione di una linea. |
| `impostaCriterio(criterio)` | Cambia criterio senza skeleton. |
| `contaScelteOttimizzato()` | Quante volte si è scelto «ottimizzato». |
| `rigaCriterioHTML()` | Riga con criterio scelto e motivo. |

## Preparazione della ricerca — 14

| Funzione | Cosa fa |
| --- | --- |
| `dataDaGiornoEOra(giorno, ora)` | `Date` da giorno e ora. |
| `hhmm(secondi)` | `HH:MM` da secondi dalla mezzanotte. |
| `minuti(secondi)` | Minuti leggibili da secondi. |
| `nomeFermata(id)` | Nome di una fermata dall'id. |
| `nomeBreve(nome)` | Nome senza «Bologna - ». |
| `etichettaFermata(id)` | Etichetta breve di una fermata. |
| `fermateConOrari()` | Fermate che hanno corse nel giorno scelto. |
| `camminoReale(da, a, metriLineari, chiediOsm)` | Tempo a piedi reale o stimato. |
| `gemelle(a, b)` | Due fermate sono lo stesso punto? |
| `candidatiPercorso(fermata)` | Fermate candidate attorno a una fermata. |
| `preparaCammini(forza)` | Precalcola le distanze a piedi fra fermate vicine. |
| `alberoFermate(elenco)` | Indice spaziale delle fermate. |
| `costruisci(punti, profondita)` | Nodo dell'albero spaziale. |
| `piuVicine(nodo, f, raggio, migliore, quante)` | Le N fermate più vicine nell'albero. |

## Percorso e dati live — 14

| Funzione | Cosa fa |
| --- | --- |
| `disegnaPercorso()` | Disegna la scheda percorso e il tracciato. |
| `calcolaPercorso()` | Prepara i dati e calcola il percorso. |
| `avviaSuggerimento(richiesta)` | Applica un suggerimento in una riga. |
| `avviaOrologio()` | Aggiorna gli orari relativi ogni 30 secondi. |
| `primaCorsaPercorso()` | Prima corsa dell'itinerario. |
| `hhmmDaSecondi(secondi)` | `HH:MM` da secondi del giorno. |
| `minutiDaAdesso(secondi)` | Distanza in minuti da adesso (-720..720). |
| `arrivoDellaCorsa(arrivi, tappa)` | Arrivo live di una corsa a una tappa. |
| `disegnaLivePercorso()` | Aggiorna ritardi e note live nella scheda. |
| `caricaLivePercorso(forza)` | Scarica gli arrivi live delle corse del percorso. |
| `ritardiPercorso()` | Ritardi per tappa e stato «a rischio» / «perso». |
| `scartaCorsaInRitardo()` | Passa all'opzione successiva se la corsa è persa. |
| `caricaLiveTappe(forza)` | Arrivi live di tutte le tappe, in parallelo. |
| `avviaTimerPercorso()` | Timer del live e delle segnalazioni. |

## HelloBus e orari — 21

| Funzione | Cosa fa |
| --- | --- |
| `relaysOrdinati()` | Relay CORS disponibili, in ordine di preferenza. |
| `fetchTesto(url, ms, segnale)` | Testo da un URL con timeout. |
| `queryHellobus(fermataId, linea, segnale)` | Query a HelloBus per fermata e linea. |
| `minutiA(ora)` | Minuti mancanti a un orario. |
| `parseHellobus(testo)` | Estrae gli arrivi dalla risposta HelloBus. |
| `fermataLive()` | Fermata della vista orari. |
| `lineeDaInterrogare(fermata)` | Linee da chiedere per una fermata. |
| `palinaConLinee(fermata)` | Palina con l'elenco delle linee. |
| `caricaLive(forza)` | Carica arrivi live della fermata. |
| `statoLiveHTML()` | Stato del live: attesa, errore, aggiornato. |
| `arriviHTML()` | Elenco unico di arrivi: live e programmati, minuti relativi entro 50. |
| `arriviUniti(f)` | Adatta la fermata e il GTFS e chiama `VistaPercorso.arriviUniti`. |
| `chiaveLinea(linea)` | Linea base condivisa con la vista (`13A` → `13`). |
| `partenzeDelGiorno(f)` | Partenze programmate del giorno. |
| `chipFiltroLinea(valore, testo)` | Chip per filtrare una linea. |
| `filtraOrariLinea(valore)` | Filtra gli orari per linea senza nuove chiamate. |
| `orariGiornoHTML(f)` | Quadro completo degli orari del giorno. |
| `renderLive()` | Disegna la vista orari. |
| `avviaTimerLive()` | Timer dei 30 secondi della vista orari. |
| `fermaTimerLive()` | Ferma il timer della vista orari. |
| `mostraVista(nome)` | Passa fra mappa e orari. |

## Pannello trascinabile — 13

| Funzione | Cosa fa |
| --- | --- |
| `altezzaVisibile()` | Altezza utile della finestra. |
| `traslazionePer(stato)` | Traslazione del pannello per ogni stato. |
| `aggiornaFisicaPannello()` | Ricalcola le posizioni dopo un ridimensionamento. |
| `applicaTrasformazione(pixel, animato, silenzioso)` | Applica la traslazione al pannello. |
| `aggiornaScrim()` | Sfumatura sopra il pannello. |
| `adattaAltezzaSheet()` | FULL all'85% dello schermo. |
| `impostaSheet(stato)` | Porta il pannello a uno stato (peek, metà, full). |
| `cicloSheet()` | Passa allo stato successivo. |
| `traslazioneAttuale()` | Traslazione corrente in pixel. |
| `puntiSheet()` | Punti di aggancio del pannello. |
| `concludiTrascinamento(velocita)` | Decide lo stato dopo il trascinamento. |
| `abilitaTrascinamento(elemento)` | Gestisce trascinamento e slancio del pannello. |
| `abilitaScorrimentoSheet()` | Scroll interno al pannello quando è pieno. |

## App, menu, service worker — 13

| Funzione | Cosa fa |
| --- | --- |
| `renderInfo()` | Disegna il pannello «Info». |
| `renderLogErrori()` | Mostra il log degli errori. |
| `cancellaDati()` | Svuota storage, cache e service worker, poi riavvia. |
| `sincronizzaMenu()` | Aggiorna lo stato del menu. |
| `apriMenu()` | Apre il menu. |
| `chiudiMenu()` | Chiude il menu. |
| `vaiVicino()` | Trova la fermata più vicina e la apre. |
| `mostraAvvisoAggiornamento(registrazione)` | Voce di menu per la nuova versione. |
| `registraServiceWorker()` | Registra il service worker e gestisce l'update. |
| `gestisciInstallazione()` | Invito all'installazione al terzo uso. |
| `collegaEventi()` | Tutti i listener dell'app. |
| `avvia()` | Avvio: theme, mappa, dati, eventi. |
| `disposizioneIniziale()` | Pannello in PEEK e schermata pronta. |

---

## Come rigenerare l'inventario

L'elenco dei nomi si ricava dal codice con:

```bash
grep -hoE '(^|[[:space:]])(async )?function [A-Za-z0-9_]+' *.js | sed -E 's/.*function //' | sort -u
```

Il grep vede solo le funzioni dichiarate con `function`: le costanti-funzione (`const nome = (...) =>`) vanno controllate a mano, sono una ventina e stanno quasi tutte dentro `routing.js` e `app.js` come helper locali.

I gruppi seguono le sezioni delimitate dai commenti `/* --- ... --- */` dentro `app.js`: se sposti una funzione, sposta anche la sua riga qui.
