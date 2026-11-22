# Tutorial: dal dataset demo ai dati reali TPER

Questa guida ti porta, passo per passo, dal dataset dimostrativo incluso nel progetto fino ad avere l'app online con i dati reali completi (9.603 fermate). Tempo stimato: 15–25 minuti la prima volta.

Non serve saper programmare: ti servono solo un browser, un terminale e la pazienza di copiare qualche comando.

---

## Passo 0 — Cosa ti serve prima di iniziare

- Un computer (Windows, Mac o Linux)
- Una connessione internet
- Un account GitHub gratuito (se non ce l'hai: https://github.com/join)
- 10 minuti per installare Python, se non lo hai già (serve solo per lo script di conversione dati, non per far girare l'app)

Verifica se hai già Python installato aprendo il terminale e scrivendo:

```bash
python3 --version
```

Se vedi un numero di versione (es. `Python 3.12.0`) sei a posto, salta al Passo 2. Se vedi un errore ("comando non trovato"), vai al Passo 1. Su Windows prova anche con `python --version` (senza il 3) prima di concludere che manca.

---

## Passo 1 — Installa Python (solo se non lo hai)

1. Vai su https://www.python.org/downloads/
2. Scarica l'installer per il tuo sistema operativo (pulsante grande in alto, è gratuito)
3. **Su Windows**: durante l'installazione spunta la casella "Add python.exe to PATH" prima di cliccare "Install Now" — è il passaggio che più spesso si dimentica
4. Riapri il terminale e verifica di nuovo con `python3 --version` (o `python --version` su Windows)

Python è open source e gratuito per sempre: nessun account, nessuna carta di credito.

---

## Passo 2 — Scarica le fermate bus ufficiali

1. Apri https://dati.emilia-romagna.it/dataset/tper-fermate-autobus
2. Cerca il pulsante di download e scarica il file in formato **JSON** (si chiamerà qualcosa come `tper-fermate-autobus.json`)
3. Salva il file scaricato dentro la cartella del progetto `tper-zone-calc`

Questo file contiene già, in un unico posto, nome, comune, zona tariffaria, coordinate **e le linee che passano da ogni fermata**: non serve più scaricare il GTFS per generare le linee bus, come spiegato nel Passo 3.

---

## Passo 3 — Converti il file in automatico con lo script incluso

1. Apri il terminale (o PowerShell su Windows)
2. Spostati nella cartella del progetto, ad esempio:
   ```bash
   cd Downloads/tper-zone-calc
   ```
   (adatta il percorso a dove hai salvato la cartella)
3. Esegui lo script di conversione incluso (richiede solo Python, nessuna libreria da installare):
   ```bash
   python3 scripts/converti-fermate-autobus.py tper-fermate-autobus.json data/fermate.json data/linee-per-fermata.json
   ```
   Su Windows, se `python3` non viene riconosciuto, prova con `python` al posto di `python3`.
4. Dovresti vedere un output simile a:
   ```
   Fatto. 9603 fermate scritte in data/fermate.json
   Linee per 8994 fermate scritte in data/linee-per-fermata.json
   (17 record scartati perché privi di zona tariffaria)
   ```

Questo comando **sovrascrive** `data/fermate.json` e `data/linee-per-fermata.json` con i dati reali, già nel formato corretto: non serve modificare nulla a mano.

> **Stazioni ferroviarie**: il dataset ufficiale TPER riguarda solo gli autobus. Lo script include già un piccolo elenco di stazioni principali scritto a mano (in cima al file `scripts/converti-fermate-autobus.py`, variabile `STAZIONI_TRENO`). Se vuoi aggiungerne altre, apri quel file con un editor di testo e aggiungi una riga seguendo lo stesso schema, poi rilancia lo script.

---

## Passo 4 (opzionale) — GTFS per orari più dettagliati

Se in futuro ti servono anche gli orari di passaggio (non solo i numeri di linea), resta disponibile il percorso basato sul feed GTFS completo di TPER (https://solweb.tper.it/web/tools/open-data/open-data-download.aspx) con lo script `scripts/preprocess-gtfs.js`, che richiede Node.js (gratuito, si scarica da https://nodejs.org, versione LTS). Per il solo calcolo di zone e prezzo, però, il Passo 3 sopra è già sufficiente: puoi saltare questo passo.

### Tabella zone tariffarie di riferimento (per consultazione)

| Zona | Area |
|---|---|
| 500 | Bologna capoluogo |
| 501 | San Lazzaro di Savena |
| 502 | Villanova |
| 503 | Quarto Inferiore |
| 504 | Corticella |
| 505 | Lippo |
| 506 | Lavino di Mezzo |
| 507 | Casalecchio |
| 509 | Rastignano |
| 510 | Imola |
| 521 | Castenaso |
| 531 | Castel Maggiore |
| 536 | Molinella |
| 541 | San Giorgio di Piano |
| 561 | Bentivoglio |
| 571 | Zola Predosa |
| 581 | Sasso Marconi |
| 582 | Marzabotto |
| 591 | Valsamoggia |

Le zone da 501 a 509 sono "zone neutre" dell'Area Urbana: nel file `index.html` sono già trattate come urbane, non serve modificare il codice.

> **Suggerimento**: non serve inserire tutte le migliaia di fermate del bacino in un colpo solo. Puoi aggiungerne un centinaio delle più usate e ampliare nel tempo: l'app funziona comunque, mostra solo meno risultati nella ricerca.

---

## Passo 5 — Testa le modifiche in locale

**Non aprire `index.html` con doppio click**: i browser bloccano il caricamento dei file JSON locali per motivi di sicurezza (CORS su `file://`).

1. Nel terminale, dentro la cartella del progetto, esegui:
   ```bash
   python3 -m http.server 8080
   ```
   (su alcuni sistemi il comando è `python` invece di `python3`)

   In alternativa, se preferisci Node.js:
   ```bash
   npx serve .
   ```
2. Apri il browser su `http://localhost:8080`
3. Prova a digitare il nome di una fermata che hai appena aggiunto: dovrebbe comparire nei suggerimenti
4. Seleziona partenza e destinazione, premi "Calcola Zone" e verifica che il risultato sia corretto
5. Per fermare il server, torna nel terminale e premi `Ctrl+C`

---

## Passo 6 — Pubblica l'app online (gratis)

### Opzione A — GitHub Pages (consigliata)

1. Vai su https://github.com/new e crea un nuovo repository (puoi chiamarlo `tper-zone-calc`)
2. Carica tutti i file del progetto nel repository: puoi trascinarli nell'interfaccia web di GitHub ("Add file" → "Upload files"), oppure con git da terminale:
   ```bash
   git init
   git add .
   git commit -m "Prima pubblicazione TPER Zone Calc"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/tper-zone-calc.git
   git push -u origin main
   ```
3. Nel repository su GitHub vai su **Settings → Pages**
4. In "Build and deployment", seleziona **Deploy from a branch**, branch `main`, cartella `/ (root)`, poi **Save**
5. Dopo circa un minuto l'app sarà online su `https://TUO-UTENTE.github.io/tper-zone-calc/`

### Opzione B — Netlify (drag & drop, ancora più semplice)

1. Vai su https://app.netlify.com e crea un account gratuito (anche con GitHub)
2. Trascina l'intera cartella `tper-zone-calc` nella pagina di Netlify dove indicato
3. In pochi secondi ottieni un link pubblico (es. `https://nome-a-caso.netlify.app`)

Entrambe le opzioni sono gratuite per sempre, senza carta di credito.

---

## Problemi comuni

| Problema | Causa probabile | Soluzione |
|---|---|---|
| L'app non trova nessuna fermata mentre scrivo | Hai aperto `index.html` con doppio click | Usa un server locale (Passo 6) |
| Lo script dà errore "File non trovato" | Il percorso al file `tper-fermate-autobus.json` è sbagliato | Controlla di aver scritto il nome file corretto e di essere nella cartella giusta (usa `dir` o `ls` per controllare) |
| Una fermata non ha nessuna linea mostrata | Nel dataset scaricato quella fermata non aveva righe con `codice_linea` valorizzato | Caso raro ma possibile nei dati sorgente; non è un bug dello script |
| Il calcolo dice "Tratta complessa" | Partenza e destinazione sono entrambe fuori dall'Area Urbana | Comportamento previsto: usa il link al calcolatore ufficiale TPER mostrato nel risultato |
| Dopo il deploy l'app mostra dati vecchi | Cache del service worker | Ricarica la pagina con "svuota cache" (Ctrl+Shift+R / Cmd+Shift+R), oppure cambia il numero di versione `v1` in `sw.js` in `v2` |
