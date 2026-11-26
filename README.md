# Muovi Bologna

Web app mobile-first (PWA) per calcolare zone tariffarie, costo del biglietto e linee bus/treno per i trasporti pubblici del bacino di Bologna (TPER + Trenitalia Tper / Mi Muovo).

**100% gratuita per sempre**: nessuna dipendenza a pagamento, nessuna carta di credito richiesta, nessun limite nascosto.

## Tabella dei componenti

| Componente | Soluzione scelta | Costo | Limiti | URL documentazione |
|---|---|---|---|---|
| Frontend | HTML + CSS + JavaScript puro (nessun framework, nessuna build) | 0 € per sempre | Nessuno: codice statico, gira in qualsiasi browser moderno | — (web standard) |
| Hosting | GitHub Pages (consigliato) — alternative equivalenti: Netlify, Vercel, Cloudflare Pages | 0 € per sempre, nessuna carta richiesta | GitHub Pages: 1 GB di spazio, 100 GB/mese di banda, limite ampiamente sufficiente per questa app | https://pages.github.com |
| Dati fermate bus | Dataset open data Regione Emilia-Romagna | 0 € — licenza aperta | Aggiornato ogni notte dal workflow `aggiorna-dati` (non in tempo reale) | https://dati.emilia-romagna.it/dataset/tper-fermate-autobus |
| Linee/orari (GTFS) | Feed open data GTFS ufficiale TPER | 0 € — licenza open data | File grande: va preprocessato offline con lo script incluso, non scaricato dal browser | https://solweb.tper.it/web/tools/open-data/open-data-download.aspx |
| Orari in tempo reale | TPER HelloBus (web service XML pubblico) | 0 € — nessuna API key | Il servizio non invia header CORS: l'app passa da un Worker proprio (`hellobus-proxy.zeno-astolfi12.workers.dev`) e, se non risponde, dal relay pubblico `api.allorigins.win`, sostituibile dal menu → Informazioni e fonti dati | https://hellobuswsweb.tper.it/web-services/hellobus.asmx |
| Calcolo del percorso | Motore RAPTOR in `routing.js` sugli orari programmati GTFS TPER (bus) e Trenitalia (treni) | 0 € — nessuna API esterna, nessuna key | Orari di tabella: la prima corsa bus mostra il passaggio reale da HelloBus, i treni restano sull'orario programmato perché non esiste un feed aperto. Il piano considera tempi di cambio diversi per bus e treno e propone percorsi alternativi distinti | https://developers.google.com/transit/gtfs |
| Meteo | Open-Meteo (`api.open-meteo.com`) | 0 € — uso non commerciale, nessuna chiave | Solo per pesare i tratti a piedi quando piove, nevica o c'è vento forte. Se non risponde, il percorso si calcola come sempre e non compare nessuna nota. La posizione inviata è quella della fermata di partenza | https://open-meteo.com |
| Percorsi a piedi | OSRM pedonale pubblico FOSSGIS (`routing.openstreetmap.de`) | 0 € — nessuna API key | Solo online: se il servizio non risponde o manca la rete si usa il segmento diritto. La richiesta contiene solo le coordinate del tratto | https://routing.openstreetmap.de |
| Coordinate stazioni | OpenStreetMap / FER, con integrazione manuale | 0 € — ODbL | Solo per le stazioni ferroviarie; nessun dato personale | https://www.openstreetmap.org |
| Orari dei treni | GTFS nazionale Trenitalia via NAP (CC BY 4.0) + PDF ufficiale TPER per la S2A | 0 € — licenza aperta | Il GTFS copre Bologna C.le, Imola e il ramo Bologna–Pianoro. La S2A Bologna–Vignola (Casalecchio inclusa) è aggiunta dai PDF TPER con validazione; la S1 Porretta resta fuori perché il PDF ufficiale non è interpretabile con affidabilità (fallback esplicito) | https://github.com/deryclem/trenitalia-gtfs · https://www.tper.it/content/linea-ferroviaria-bologna-vignola |
| Tracciato dei bus sulla mappa | Shapes GTFS TPER disegnate così come sono | 0 € — nessuna API key, nessun servizio esterno | La linea è quella reale della linea: nessun map matching stradale, che su queste shape restituiva una strada più corta del percorso del bus | https://developers.google.com/transit/gtfs |
| Geometria dei binari | OpenStreetMap (`railway=rail`) via Overpass, usata solo per rigenerare `data/tracciati.json` | 0 € — ODbL | Le shapes del GTFS nazionale hanno solo 5–8 punti e tagliavano fuori dai binari; la geometria viene ricostruita una volta e salvata nel dataset, non interrogata a runtime | https://www.openstreetmap.org |
| Mappa | MapLibre GL + OpenFreeMap (stile Liberty) | 0 € — nessuna API key, nessun limite | Richiede connessione per stile e tile vettoriali; ricerca fermate, zone e prezzi restano offline | https://openfreemap.org |
| Ricerca luoghi e indirizzi | Nominatim (OpenStreetMap) | 0 € — nessuna API key | Solo online e con limite di 1 richiesta al secondo; il testo cercato viene inviato a OpenStreetMap. Cerca sia per nome di luogo sia per indirizzo. Senza connessione restano le fermate | https://nominatim.org |
| PWA (installabilità + offline) | `manifest.json` completo + icone PNG/maskable + Service Worker nativo del browser | 0 € — standard web nativo | Nessuno | https://developer.mozilla.org/docs/Web/Progressive_web_apps |
| Icone app | PNG 192/512, maskable 192/512 e apple-touch 180, con sorgenti SVG incluse | 0 € | PNG generati localmente, nessun servizio esterno | — |
| Icone interfaccia | Lucide (ISC), SVG inline in `icone.js` | 0 € | Nessuna CDN o font di icone: restano disponibili offline | https://lucide.dev |
| Preprocessing GTFS | Script Node.js incluso (`scripts/preprocess-gtfs.js`), solo moduli nativi | 0 € — Node.js è open source | Richiede Node.js installato in locale, solo per rigenerare i dati, non per l'uso dell'app | https://nodejs.org |
| Test automatici | Node.js test runner (`node --test tests`), nessuna dipendenza | 0 € — Node.js è open source | Solo per sviluppo: non vengono caricati dal browser | https://nodejs.org/api/test.html |

Nessun componente richiede carta di credito, free trial a scadenza o abbonamento.

## Struttura del progetto

```
tper-zone-calc/
├── index.html                    # Struttura e stili dell'app (mappa, ricerca, bottom sheet)
├── app.js                        # Logica: fermate, calcolo zone, orari live, mappa
├── routing.js                    # Calcolo del percorso (linee, orari, cambi) sugli orari GTFS
├── vista-percorso.js             # Rendering HTML della scheda percorso (tempi, cambi, tratti a piedi)
├── tariffe.js                    # Logica pura di zone e prezzi (testabile senza DOM)
├── piedi.js                      # URL, cache e parsing OSRM pedonale (coordinate [lon, lat])
├── icone.js                      # Set unico di icone Lucide, SVG inline (ISC)
├── manifest.json                  # Manifest PWA
├── sw.js                          # Service worker (cache offline)
├── icons/
│   ├── icon-192.png / icon-512.png            # Icone installabili (any)
│   ├── icon-maskable-192.png / -512.png       # Icone maskable Android
│   ├── apple-touch-icon.png                   # Icona iOS 180×180
│   ├── icon-192.svg / icon-512.svg            # Sorgenti vettoriali
│   └── icon-maskable-192.svg / -512.svg
├── data/
│   ├── fermate.json                # 9.634 fermate: bus reali + 42 stazioni ferroviarie (tutte le fermate delle linee Vignola, Porretta e Pianoro)
│   ├── linee-per-fermata.json      # Linee che servono ciascuna fermata (dal dataset ufficiale)
│   ├── linee-colori.json           # Colore ufficiale di ogni linea (GTFS route_color) per scheda e mappa
│   ├── orari.json                  # Orari di tutte le corse bus + 168 corse treno (~5,9 MB)
│   ├── orari.json.gz               # Stessa cosa in gzip (~272 KB): è questo che l'app scarica
│   ├── tracciati.json              # Geometrie reali di bus e treni (1.641 forme, ~1,8 MB)
│   └── tracciati.json.gz           # Stessa cosa in gzip (~411 KB): scaricata solo quando serve il percorso
├── scripts/
│   ├── converti-fermate-autobus.py # Converte il dataset ufficiale TPER (bus) nei due file dati sopra
│   ├── estrai-colori-linee.py      # Estrae i colori ufficiali delle linee da routes.txt del GTFS
│   ├── preprocess-orari.js         # Dal GTFS TPER genera data/orari.json e data/tracciati.json per i bus
│   ├── aggiungi-treni.js           # Unisce le corse del GTFS nazionale Trenitalia al dataset bus
│   ├── aggiungi-treni-locali.js    # Aggiunge le corse S2A Vignola dai PDF TPER, con validazione
│   ├── ricostruisci-tracciati.js   # Riproietta le fermate sulle forme e ricostruisce i binari da OSM
│   └── preprocess-gtfs.js          # (opzionale) elabora il GTFS completo, utile solo per dati extra
├── tests/
│   ├── dati.test.js                # Invarianti dei JSON (fermate, corse, forme, treni)
│   ├── routing.test.js             # Percorsi, cambi, cammini, calendari e mezzanotte
│   ├── tariffe.test.js             # Zone e prezzi bus/treno
│   ├── piedi.test.js               # Coordinate, chiave e risposta OSRM pedonale
│   ├── icone.test.js               # Set Lucide unico, dimensioni e semantica
│   ├── vista.test.js               # Scheda percorso, treni, escaping e stati vuoti
│   └── integrale.test.js           # Percorsi reali Bologna–Imola, Vignola S2A e ramo Pianoro con geometria
└── README.md
```

> **Dataset incluso**: i file in `data/` contengono ora il dataset reale e completo delle fermate bus TPER (9.603 fermate, con le linee che le servono), più 31 nuove stazioni ferroviarie per un totale di 42: tutte le fermate delle linee **Bologna–Vignola**, **Bologna–Porretta** e **Bologna–Pianoro**. Se TPER aggiorna il proprio dataset open data, rilancia lo script `scripts/converti-fermate-autobus.py` (vedi sotto) per rigenerare i dati.

## Deploy gratuito (GitHub Pages)

1. Crea un repository GitHub pubblico (o privato, GitHub Pages funziona comunque con piano gratuito su repo pubblici) e carica tutti i file di questo progetto nella root.
2. Vai su **Settings → Pages** del repository.
3. In "Build and deployment" seleziona **Deploy from a branch**, branch `main`, cartella `/ (root)`.
4. Salva: dopo circa un minuto l'app sarà disponibile su `https://<tuo-utente>.github.io/<nome-repo>/`.
5. Nessuna carta di credito o account a pagamento richiesto.

### Alternative altrettanto gratuite

- **Netlify** (https://www.netlify.com): trascina la cartella del progetto su app.netlify.com, oppure collega il repo GitHub per deploy automatici. Piano free permanente, nessuna carta richiesta.
- **Vercel** (https://vercel.com): stesso principio, deploy da GitHub. Piano Hobby gratuito permanente.
- **Cloudflare Pages** (https://pages.cloudflare.com): deploy da GitHub, piano free permanente generoso.

In tutti i casi, trattandosi di file statici (nessun server, nessun database), il deploy è immediato: basta puntare alla root del progetto.

## Come aggiornare i dati (dataset completo)

### Aggiornamento automatico (GitHub Actions)

Il workflow `.github/workflows/aggiorna-dati.yml` gira ogni notte alle 03:17 UTC e a richiesta da **Actions → Aggiorna dati TPER → Run workflow**. Esegue `node scripts/aggiorna-dati.js`, cioè l'intero giro qui sotto in un solo comando: fermate bus, GTFS TPER (versione letta da SolWeb), orari, colori, treni nazionali e locali, riparazione delle geometrie, gzip. Poi esegue `npm test`, incrementa la versione delle cache in `sw.js` con `npm run bump` e fa commit e push su `main` solo se i dati sono davvero cambiati: quel push è anche il deploy di GitHub Pages.

Le fonti e i controlli di sicurezza:

- **Fermate**: prima l'API CKAN della Regione, poi l'export Opendatasoft del Comune di Bologna (stessi campi), che è quello usato quando il portale regionale non risponde.
- **GTFS TPER**: la versione corrente viene letta dalla pagina SolWeb; nessun numero di versione da aggiornare a mano.
- **Treni**: GTFS nazionale (mirror pubblico CC BY 4.0, sostituibile) e PDF ufficiale degli orari locali S2A. Le geometrie ferroviarie vengono ricostruite su OpenStreetMap con Overpass.
- **Niente dati a metà**: prima di scrivere, il dataset attuale viene copiato in `.tmp-dati/prima`. Se una fase fallisce, se manca una stazione o se le fermate, le corse o le forme calano di oltre il 10%, la copia viene ripristinata e il workflow esce in errore senza pubblicare nulla.
- **Niente commit inutili**: se il contenuto è identico a parte il campo `aggiornato`, il workflow non produce modifiche e non fa commit.

Per lanciarlo in locale servono Node.js 18+, Python 3, `unzip` e `pdftotext` (`apt-get install -y poppler-utils unzip`), poi:

```bash
npm run dati          # oppure: node scripts/aggiorna-dati.js
npm test && npm run bump
```

Quando una fonte cambia indirizzo si può passare un URL alternativo da **Run workflow** (`versione_gtfs`, `url_fermate`, `url_gtfs_treni`, `url_pdf_treni`) o con le stesse variabili d'ambiente in locale (`VERSIONE_GTFS`, `URL_FERMATE`, `URL_GTFS_TPER`, `URL_GTFS_TRENI`, `URL_PDF_TRENI`). Quando TPER pubblica il nuovo orario ferroviario serve invece aggiornare il periodo di validità in `scripts/aggiungi-treni-locali.js` (`VALIDITA`) insieme al PDF: la pipeline si ferma dichiarandolo, non inventa corse.

### A) Fermate bus + linee (metodo consigliato, un solo file)

Il dataset ufficiale `tper-fermate-autobus.json` della Regione Emilia-Romagna contiene **già tutto il necessario in un unico file**: un record per ogni combinazione fermata+linea, con nome, comune, zona tariffaria e coordinate. Non serve più scaricare ed elaborare il GTFS per i bus.

1. Scarica il JSON ufficiale da: https://dati.emilia-romagna.it/dataset/tper-fermate-autobus
2. Esegui lo script Python incluso (richiede solo Python 3, nessuna libreria da installare):
   ```bash
   python3 scripts/converti-fermate-autobus.py tper-fermate-autobus.json data/fermate.json data/linee-per-fermata.json
   ```
3. Lo script genera direttamente sia `data/fermate.json` sia `data/linee-per-fermata.json`, già nel formato corretto, raggruppando automaticamente le righe per fermata.

Esempio di output atteso:
```
Fatto. 9603 fermate scritte in data/fermate.json
Linee per 8994 fermate scritte in data/linee-per-fermata.json
(17 record scartati perché privi di zona tariffaria)
```

### B) Stazioni ferroviarie

Il dataset ufficiale sopra riguarda **solo gli autobus**. Le stazioni ferroviarie regionali sono incluse a mano nello script, nell'elenco `STAZIONI_TRENO` in cima a `scripts/converti-fermate-autobus.py`: aggiungi lì le stazioni che ti servono (nome, zona, coordinate) e rilancia lo script.

In alternativa, per un elenco più completo delle linee ferroviarie, resta disponibile il percorso GTFS descritto nella sezione "Metodo alternativo (GTFS)" più sotto, da cui si possono estrarre anche le stazioni.

Le 42 stazioni coprono l'intero elenco delle fermate delle linee **Bologna–Vignola** (18), **Bologna–Porretta** (17) e **Bologna–Pianoro** (7), comprese le fermate minori come Riale, Pilastrino, Zola, Crespellano, Vergato e Rastignano.

Gli **orari dei treni** vengono dal GTFS nazionale Trenitalia via NAP (CC BY 4.0) e, per la linea locale **S2A Bologna–Vignola**, dai PDF ufficiali TPER. La S2A comprende Bologna C.le, Borgo Panigale, Casteldebole, Casalecchio Garibaldi, Ceretolo, Palasport, le fermate della Val Samoggia e Vignola. Le corse sono validate su sequenza fermate, orari monotoni e periodicità prima di entrare nel dataset; le corse con nota 3 (periodicità estiva con sabati soppressi) restano fuori. La linea **S1 Porretta** non viene importata: il PDF S1/Trenitalia Tper ha colonne con note grafiche e periodicità non verificabili con affidabilità, quindi il pianificatore non inventa orari intermedi e lo dichiara nel menu → Informazioni e fonti dati. Dopo aver rigenerato il dataset bus, unisci le corse ferroviarie con:

```bash
node scripts/aggiungi-treni.js gtfs-trenitalia data/orari.json data/tracciati.json
```

Lo script rifiuta di girare due volte sullo stesso dataset, così non duplica le corse. Se in futuro il GTFS nazionale includerà altre stazioni, aggiungile all'elenco `STAZIONI` in cima a `scripts/aggiungi-treni.js` (codice `stop_code` NAP e id `TRN…` usato in `data/fermate.json`).

Dopo l'unione ferroviaria esegui la riparazione delle geometrie:

```bash
node scripts/ricostruisci-tracciati.js --scrivi
```

Lo script ricalcola la proiezione di ogni fermata sulla propria forma (monotona e sul segmento, non sul solo vertice), inserisce il punto di proiezione nella polilinea e sostituisce le forme ferroviarie troppo rade con il percorso reale sulla rete `railway=rail` di OpenStreetMap. La prima volta scarica i binari da Overpass e li mette in `.tmp-binari/` (ignorato da Git); senza `--scrivi` esegue solo le verifiche. Non è necessario a runtime: il risultato resta in `data/tracciati.json`. Il bbox predefinito comprende ora anche la tratta Casalecchio–Vignola; se hai una cache `.tmp-binari/binari.json` scaricata prima di questa modifica, cancellala o passa un file OSM aggiornato con `--osm`.

### Orari treni locali TPER (S2A)

La linea **S2A Bologna–Vignola** viene letta dal PDF ufficiale TPER:

```text
https://s3.eu-south-1.amazonaws.com/static.tper.it/orari/20251213treni/tper_trbovi.pdf
```

Il PDF è valido dal 14 dicembre 2025 al 12 dicembre 2026: quando TPER pubblica il nuovo orario, sostituisci il file e rilancia lo script. Serve `pdftotext` (Xpdf o Poppler) per l'estrazione; in alternativa estrai il testo con `pdftotext -table -enc UTF-8` e passa `--testo`.

```bash
# prova: non scrive nulla, stampa corse e validazioni
node scripts/aggiungi-treni-locali.js --pdf .tmp-pdf/vignola.pdf

# applica al dataset (una sola volta: lo script rifiuta di duplicare S2A)
node scripts/aggiungi-treni-locali.js --pdf .tmp-pdf/vignola.pdf --scrivi

# ricostruisce le geometrie ferroviarie, Vignola compresa
node scripts/ricostruisci-tracciati.js --scrivi
```

Lo script controlla che ogni corsa abbia una sequenza di fermate coerente, orari strettamente crescenti e nessun salto superiore a 30 minuti tra due fermate; se una colonna non è interpretabile si ferma senza scrivere. Le note di periodicità 0/4 sono importate, le note 1/2 sono divise nelle due fasce stagionali, le note 5/6 (bus sostitutivi) sono escluse e le note 3 sono saltate con un messaggio esplicito. Le corse parziali (per esempio Bologna–Bazzano) restano nel dataset con il loro capolinea reale. Le corse festive vengono applicate anche alle festività nazionali del periodo di validità tramite `eccezioni`, così l’8 dicembre o il 25 aprile non usano l’orario feriale.

**Fallback Porretta:** la S1 non viene importata. Il PDF ufficiale è [S1 Porretta–Bologna–Pianoro](https://www.sfmbo.it/sfm/La_rete/S1_Porretta_Bologna_Pianoro), ma la sua impaginazione nazionale e le note di periodicità non sono state ritenute verificabili con sufficiente affidabilità. In questo caso il pianificatore usa solo le corse presenti nel GTFS nazionale (che coprono Porretta come stazione, senza le fermate intermedie) e menu → Informazioni e fonti dati dichiara il limite: nessuna corsa viene inventata.

### Calcolo del percorso (bus e treni)

Il blocco **Percorso** nel pannello calcola quali bus prendere, a che ora e con quanti cambi, come un pianificatore di viaggio. Non usa nessun servizio esterno: `routing.js` legge `data/orari.json.gz` (tutti i passaggi di tutte le corse TPER) e applica un algoritmo RAPTOR lato browser.

Il criterio è l'arrivo più presto a destinazione, non il minor numero di corse: il RAPTOR usa un doppio buffer (le corse prese in un giro non si possono riusare nello stesso giro) e predecessori per giro, così la ricostruzione non entra in cicli. Sono ammessi fino a 3 cambi e i cambi a piedi tra fermate vicine vengono trattati come un cambio normale, non come una corsa: la distanza massima è quella scelta dall'utente (vedi sotto). La destinazione si sceglie porta a porta, cammino finale compreso, quindi una fermata a due passi può battere quella scritta nel campo.

Dal menu → **Linee da evitare** si esclude una linea da ogni ricerca (alternative e treno+bus compresi): l'elenco resta in `localStorage` (`tperzc_linee_evitate_v1`) e si toglie toccando il chip. Se tutte le linee utili sono escluse, la scheda lo dice invece di mostrare un errore generico.

Sopra le opzioni c'è il cursore **A piedi**: da 3 a 25 minuti (default 10) di cammino che l'utente è disposto ad accettare. Il valore resta salvato in `localStorage` (`tperzc_camminata_v1`) e diventa il raggio entro cui il pianificatore cerca le fermate di partenza e di arrivo e entro cui può proporre un cambio a piedi tra due fermate, oltre al limite di cammino di ogni singolo tratto (`camminoMax` passato a `TPERRouting.calcola`). Con 3 minuti il raggio è di circa 225 m, con 25 minuti di circa 1900 m. Le coppie di fermate raggiungibili a piedi si calcolano con un k-d tree sulle 9603 fermate (le 12 più vicine per fermata), così anche la soglia massima resta sotto il decimo di secondo.

Dentro la soglia del 15% di tempo in più rispetto alla soluzione più veloce, l'algoritmo sceglie il percorso con meno attrito (cambi, cammino, attese) e lo mostra come unico consiglio; non ci sono criteri da selezionare. Con pioggia, neve o vento forte il cammino pesa il doppio, quindi risalgono le proposte con meno tratti a piedi. Il meteo viene letto da Open-Meteo sulla fermata di partenza, resta in memoria un quarto d'ora e non blocca mai il calcolo del percorso; nessuna nota lo segnala in scheda.

La scheda mostra fino a sei **opzioni** in una fila che scorre: ognuna riporta orari, durata, cambi, minuti a piedi e le linee con il loro colore; toccandone una si apre l'itinerario completo e la mappa passa a disegnare quel percorso. Con "Parti alle" le alternative sono le partenze successive, con "Arriva entro" sono i viaggi che arrivano entro la scadenza con almeno 5 minuti di margine (il primo è quello che parte più tardi; sotto i 2 minuti il margine è segnalato come «poco margine»). In modalità "Parti alle / Adesso" l'ora segue il tempo reale: ogni 30 secondi, al cambio di minuto, il percorso viene ricalcolato da solo.

Dalla scheda del viaggio si può **salvare la tratta** (fino a cinque viaggi nel menu, con l'ora e il tipo di ricerca) e usare il pulsante di inversione per pianificare il **ritorno** subito dopo l'arrivo previsto. Un luogo condiviso da Maps o da un'altra app può arrivare direttamente come destinazione tramite il Web Share Target; se il link non contiene coordinate, l'app prova prima una fermata e poi Nominatim.

**Navigazione**: con partenza e destinazione scelte, il pulsante **Avvia navigazione** nella scheda del percorso apre la modalità guida. L'app segue la posizione GPS (`watchPosition`, alta precisione) con un punto blu sulla mappa, tiene la camera centrata sull'utente e mostra in alto il passo da seguire — a piedi fino alla fermata, la linea da prendere con la fermata di discesa, il cammino finale — con la distanza che manca, e in basso l'orario di arrivo previsto e il pulsante **Termina**. Trascinando la mappa l'inseguimento si disattiva e compare il pulsante per ricentrare. La navigazione riusa il percorso già calcolato (nessun nuovo routing) e richiede il permesso di geolocalizzazione del browser.

Per rigenerare gli orari dal feed GTFS ufficiale:

```bash
# 1. scarica e scompatta il GTFS TPER (aggiorna la versione nella URL)
curl -L -o gtfs.zip "https://solweb.tper.it/web/tools/open-data/open-data-download.aspx?source=solweb.tper.it&filename=gommagtfsbo&version=20261111&format=zip"
unzip gtfs.zip -d gtfs-tper

# 2. genera data/orari.json e data/tracciati.json(.gz) (Node.js, nessuna dipendenza)
node scripts/preprocess-orari.js gtfs-tper data/orari.json

# 3. comprimi gli orari: è il file che l'app scarica davvero
#    (tracciati.json.gz viene già scritto in gzip dallo script)
gzip -9 -c data/orari.json > data/orari.json.gz

# 4. colori delle linee: 232 linee, dal campo route_color di routes.txt
python3 scripts/estrai-colori-linee.py gtfs-tper/routes.txt data/linee-colori.json
```

Nel pannello del percorso la mappa mostra la linea del bus con la geometria ufficiale del GTFS, senza map matching stradale: il servizio di routing stradale, interrogato su queste forme, restituiva una strada più corta del percorso reale (misurato: −8% su una tratta di 638 m), cioè la via più veloce tra le fermate invece del giro che fa il bus. Se una tratta non ha geometria si disegna la linea diritta tratteggiata, dichiarata come tale. Senza rete si vedono comunque fermate, orari e prezzo.

Lo stesso script legge anche `shapes.txt` e produce `data/tracciati.json`: la geometria reale di ogni linea (semplificata a 8 m di tolleranza e codificata come polilinea), allineata corsa per corsa a `orari.json`. È così che il pannello del percorso disegna sulla mappa il percorso del bus invece di una linea dritta tra le due fermate; i tratti a piedi restano tratteggiati. Per le corse ferroviarie le shapes del GTFS nazionale sono troppo rade (5–8 punti, con salti anche di 17 km): `scripts/ricostruisci-tracciati.js` le sostituisce con il percorso sulla rete ferroviaria OpenStreetMap, stazione per stazione, e riproietta le fermate sui binari. La geometria resta nel dataset, quindi l'app non contatta Overpass.

I **tratti a piedi** seguono le strade: l'app chiede la geometria a OSRM pedonale FOSSGIS (`routing.openstreetmap.de`), la salva in `localStorage` (massimo 100 tratti) e la riusa. Se il servizio non risponde, il tratto resta un segmento diritto tratteggiato: il calcolo del percorso non si blocca mai per il routing pedonale. Sulla linea partenza, cambi e arrivo hanno nodi distinti (rosso, anello bianco con corona, nero), mentre i pallini delle fermate intermedie sono proiettati sul tracciato disegnato e prendono il colore della linea su cui si trovano: restano la fermata reale, ma appoggiati alla linea invece di fluttuarle accanto (oltre 60 m di scarto la geometria è considerata inaffidabile e il pallino resta sulla fermata). Se una tratta non ha la geometria GTFS viene disegnata come linea diritta tratteggiata e la scheda del percorso lo dichiara.

Ogni linea ha il suo colore, preso dal campo `route_color` del GTFS TPER (`data/linee-colori.json`): lo stesso compare nel badge della scheda viaggio, nei badge degli arrivi della vista orari e sul tracciato della mappa, così un cambio di linea si vede a colpo d'occhio. I colori ufficiali molto chiari vengono scuriti appena solo sulla mappa, per restare leggibili sul basemap chiaro; le linee senza colore nel GTFS restano rosso TPER. I treni hanno il badge rosso TPER e si chiamano per categoria, non con il nome della linea GTFS: **REG** per i regionali (anche i suburbani S1A/S2A, che sono regionali) e **RV** per i regionali veloci. Anche sulla mappa la tratta ferroviaria è rossa.

Oltre alle fermate si possono cercare **luoghi e indirizzi**: i suggerimenti arrivano da Nominatim (OpenStreetMap), con debounce e una richiesta al secondo come da policy d'uso. Si può scrivere direttamente il nome di un posto (per esempio "Mercato di Mezzo", "Farmacia Marco Polo", "Parco di Villa Spada") senza conoscerne l'indirizzo; i risultati sono divisi in **Luoghi** e **Indirizzi** e per i luoghi è indicata la categoria (mercato, farmacia, negozio, parco…). Il luogo o indirizzo scelto viene usato con le sue coordinate esatte: il percorso parte e arriva dalla fermata più comoda entro 500 m, mentre la zona per il prezzo è quella della fermata più vicina (quindi fuori dall'area urbana la stima può essere approssimativa).

Il calcolo usa anche le fermate a pochi passi da quella scelta (pali opposti, fermate della stessa via) e mostra i tratti a piedi stimati, sia nei cambi sia all'arrivo; sulla mappa sono tratteggiati. Gli orari sono quelli programmati nel GTFS: non tengono conto dei ritardi reali (per quelli c.è la vista orari della fermata). Quando OSRM non ha ancora restituito la geometria di un tratto a piedi, la scheda lo dichiara con la nota «tempi a piedi stimati»: in quel caso il tempo viene dalla distanza in linea d'aria, non dal percorso reale.

### Metodo alternativo (GTFS, opzionale)

Se in futuro vuoi anche gli orari di passaggio o un elenco linee più dettagliato (non solo i numeri di linea), resta disponibile lo script `scripts/preprocess-gtfs.js` (richiede Node.js) che elabora il feed GTFS completo di TPER da https://solweb.tper.it/web/tools/open-data/open-data-download.aspx. Per il solo calcolo zone/prezzo, però, il metodo A) sopra è sufficiente e molto più semplice.

### C) Zone tariffarie di riferimento (sistema Mi Muovo)

- **500** — Bologna capoluogo
- **Zone neutre Area Urbana** (coperte da abbonamento urbano se solo attraversate): 501 San Lazzaro, 502 Villanova, 503 Quarto Inferiore, 504 Corticella, 505 Lippo, 506 Lavino di Mezzo, 507 Casalecchio, 509 Rastignano
- **Prime cinture extraurbane**: 521 Castenaso, 531 Castel Maggiore, 541 San Giorgio di Piano, 561 Bentivoglio, 571 Zola Predosa, 581 Sasso Marconi, 582 Marzabotto, 591 Valsamoggia, 510 Imola, 536 Molinella

Le zone neutre non aggiungono scatti se solo attraversate; aggiungono uno scatto solo se la destinazione finale è lì e non si ha l'abbonamento urbano.

## Tariffe (indicative, da verificare)

- Bus urbano / 1 zona: 2,30 € (riforma marzo 2025)
- Bus 2 zone: 2,90 €
- Bus 3 zone: 3,70 €
- Bus 4 zone: 4,50 €
- Treno regionale: tariffa regionale Trenitalia Tper a scaglioni di km, 2ª classe (1–10 km 2,90 €, 11–20 3,40 €, 21–30 4,00 €, 31–40 4,90 €, 41–50 5,40 €, 51–60 5,70 €, 61–70 6,40 €, …). Bologna–Imola sono 34 km, quindi 4,90 €: non 3,10 € come diceva la vecchia stima "a due zone". L'app misura i km in linea d'aria tra le due fermate, quindi vicino ai confini di scaglione il prezzo può differire di una fascia. Le linee FER (Bologna–Portomaggiore, Bologna–Vignola) fanno eccezione: lì valgono i titoli a zone, come sui bus.

**Verifica sempre il prezzo esatto su tper.it, trenitaliatper.it o sul calcolatore ufficiale** (https://solweb.tper.it/web/tools/zone-calculator.aspx): questa app fornisce una stima rapida, non un biglietto valido.

## Provare l'app in locale (prima del deploy)

**Non aprire `index.html` con un doppio click.** I browser bloccano per sicurezza il caricamento di file JSON locali via `fetch()` quando la pagina è aperta con il protocollo `file://` (errore CORS). In quel caso l'app passa a un elenco di fermate molto ridotto e il calcolo può sembrare "non funzionare" se non selezioni una fermata presente in quell'elenco ridotto.

Per testare in locale, avvia un piccolo server statico nella cartella del progetto, ad esempio:

```bash
# Con Python (incluso in quasi tutti i sistemi)
python3 -m http.server 8080

# oppure con Node.js, senza installare nulla
npx serve .
```

Poi apri `http://localhost:8080` nel browser: a quel punto `fetch()` funziona normalmente e l'app carica il dataset completo di `data/fermate.json`.

Una volta pubblicata su GitHub Pages/Netlify/Vercel/Cloudflare Pages (vedi sopra), questo problema non si presenta più, perché il sito viene servito via `https://`.

## Test automatici

La logica critica è coperta da test Node.js senza dipendenze esterne (50 test): dati e invarianti dei JSON, RAPTOR (diretto, cambi, cammini, calendari, dopo mezzanotte), tariffe, coordinate e risposta OSRM pedonale, icone Lucide, scheda percorso e un percorso reale Bologna C.le–Imola in treno con la sua geometria.

```bash
node --test tests
```

I test non richiedono browser né rete: usano i file in `data/` e un `fetch` simulato per il motore. Vanno eseguiti dopo ogni modifica a `routing.js`, `tariffe.js`, `piedi.js`, `icone.js`, `vista-percorso.js`, agli script di preprocessing o ai dati.

## Limiti noti

- Il dataset bus è reale e completo (9.603 fermate), ma alcune fermate compaiono due volte con lo stesso nome: sono i due "pali" della stessa fermata, uno per ciascun senso di marcia. È normale: selezionando l'uno o l'altro il risultato del calcolo non cambia.
- Le stazioni ferroviarie sono una lista curata a mano (11 stazioni principali): il dataset ufficiale TPER riguarda solo gli autobus. Aggiungine altre modificando `STAZIONI_TRENO` in `scripts/converti-fermate-autobus.py`. Gli orari dei treni esistono solo per le stazioni presenti nel GTFS nazionale (Bologna C.le, Imola, Pianoro): per le altre l'app suggerisce una fermata bus vicina.
- I prezzi dei treni regionali sono stime a zone: il prezzo reale di Trenitalia Tper dipende dai chilometri effettivi della tratta.
- Il dataset aggiornato copre l'intera rete TPER (anche zone di Ferrara/Imola oltre al bacino di Bologna): per queste zone più lontane l'app applica comunque la stessa logica generale urbano/extraurbano, ma le regole di confine specifiche (Zola Predosa, Sasso Marconi) restano pensate per il bacino di Bologna.
- La logica di calcolo gestisce i casi "urbano↔urbano" e "urbano↔extraurbano" con regole precise; per tratte tra due zone extraurbane l'app rimanda al calcolatore ufficiale TPER, perché il numero di scatti dipende dal percorso esatto.
- **Percorso**: il pianificatore usa gli orari programmati del GTFS e parte dalla data e ora scelte. Il cambio tra due bus chiede 3 minuti (30 secondi se è la stessa linea), quello che coinvolge un treno 4 (banchina e scale) e 6 tra due treni; le alternative si ottengono vietando a turno la linea principale, così non sono quattro partenze della stessa corsa. Con "Arriva entro" le opzioni sono ordinate dall'arrivo più tardi ma in tempo, con 5 minuti di margine richiesti sulla scadenza. La domenica il feed TPER include soprattutto corse extraurbane: per molte fermate urbane il risultato può essere "nessun collegamento", ed è un limite del dato, non dell'app. I treni sono usabili solo su Bologna C.le, Imola e Pianoro; per le altre stazioni ferroviarie (codici `TRN…`) non ci sono orari aperti e l'app suggerisce una fermata vicina.
- **Percorsi a piedi**: la geometria arriva da OSRM pedonale FOSSGIS, che richiede connessione. Senza rete, o se il servizio è occupato, i tratti a piedi restano segmenti diritti tratteggiati; il percorso e i prezzi funzionano comunque.
- **Orari in tempo reale**: la vista orari interroga HelloBus, il servizio TPER con la posizione GPS dei bus. Anche la scheda del percorso mostra il passaggio reale della prima corsa bus (LIVE o orario programmato, con l'eventuale ritardo) e lo aggiorna ogni 30 secondi. Per i treni non esiste un feed in tempo reale aperto: l'app lo scrive e mostra l'orario programmato invece di inventare un ritardo. Il servizio non abilita CORS, quindi dal browser si passa da un Worker proprio (`hellobus-proxy.zeno-astolfi12.workers.dev`) e, in fallback, dal relay pubblico `api.allorigins.win`. I relay gratuiti possono essere lenti o non raggiungibili: in quel caso l'app mostra un messaggio con "Riprova" e il pulsante "Usa il relay predefinito". Nel menu → Informazioni e fonti dati puoi incollare un relay tuo (`https://tuo-relay/?url={url}`) per non dipendere da servizi terzi.
- Alcuni codici fermata del dataset regionale non sono gestiti da HelloBus o non hanno corse nelle ore serali: l'app lo segnala con un messaggio invece di mostrare un elenco vuoto.
- Le tile della mappa arrivano da OpenFreeMap/OpenStreetMap: senza connessione la mappa resta grigia, ma ricerca fermate, zone e prezzi continuano a funzionare con i dati in cache.

## Funzionamento offline

Al primo caricamento online, l'app salva in cache (Service Worker + localStorage) i file statici e i dati delle fermate. Alle visite successive, anche senza connessione, l'app si apre normalmente e mostra l'ultimo dataset scaricato, con una stale-while-revalidate per aggiornare i dati in background appena torna la connessione.

Se il dataset remoto non è raggiungibile e non esiste ancora una cache locale, l'app mostra un elenco ridotto di fermate principali (fallback hardcoded) e un messaggio con pulsante "Riprova".
