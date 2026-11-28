# Intelligenza: pesi, soglie e cosa manca

`intelligenza.js` contiene i conti dei livelli 1–4 del prompt «Intelligenza
completa». È un modulo **puro**: nessun DOM, nessuna `fetch`, nessun
`localStorage`. Riceve dati già letti e restituisce numeri o piccoli oggetti.
Serve a una cosa sola: che i pesi si possano provare uno per uno invece di
fidarsi di un percorso che «sembra migliore».

Regola che vale ovunque: **un dato che non c'è vale zero**. Se HelloBus, il
meteo o lo storico non rispondono, l'aggiustamento è 0 e il percorso resta
quello del livello 0. L'intelligenza non blocca mai il calcolo.

## Pesi (secondi equivalenti)

| Peso | Valore | Perché |
| --- | --- | --- |
| `CAMBIO` | 300 | un cambio costa come 5 minuti: è la fatica, non il tempo |
| `CAMMINO` | 1.3 | un metro a piedi vale 1,3 secondi, cioè più del tempo in moto |
| `ATTESA` | 0.6 | aspettare pesa meno che stare in movimento |
| `RITARDO` | 1.0 | un minuto di ritardo è un minuto vero |
| `AFFIDABILITA` | 120 | ±2 minuti: abbastanza per rompere un pareggio, non per ribaltare un percorso chiaramente più veloce |

Tutti in `PESI` in cima al file. Cambiarli lì cambia il comportamento ovunque,
e i test dicono subito se il risultato non è più quello atteso.

## Soglie

| Soglia | Valore | Uso |
| --- | --- | --- |
| `RITARDO_VISIBILE` | 120 s | sotto i 2 minuti non si scrive nulla: è rumore |
| `RITARDO_ABBANDONO` | 900 s | oltre 15 minuti la corsa si scarta |
| `OSSERVAZIONI_MINIME` | 5 | sotto, l'affidabilità resta neutra (0,5) |
| `OSSERVAZIONI_MAX` | 500 | tetto dello storico locale |
| `GIORNI_STORICO` | 30 | oltre, le osservazioni non dicono più nulla |
| `RITARDO_MASSIMO` | 1800 s | oltre mezz'ora è rumore, non ritardo |

## Cambi a rischio

Il buffer effettivo è `partenza2 − arrivo1 − ritardoLive1`. La probabilità di
perdere il cambio è quella del prompt: sotto 60 s → 90%, sotto 120 s → 70%,
sotto 180 s → 40%, altrimenti 5%. Sotto il 50% il cambio non viene segnalato:
a 90 secondi di buffer **lo è** (70%), e questo è voluto, non un difetto.

## Storico

Si salvano solo `linea`, `giorno`, `ora`, `ritardo` e `ts`. **Nessuna
coordinata, nessun identificativo del dispositivo.** Il test
`lo storico non salva coordinate GPS` confronta le chiavi dell'oggetto
salvato: se qualcuno aggiunge `lat` o `lon`, il test fallisce.

La stima usa mediana e MAD, non media e deviazione standard: un bus in ritardo
di mezz'ora in un giorno di neve non deve spostare la previsione di tutti gli
altri giorni.

## Personalizzazione e suggerimenti

La priorità dei suggerimenti è `N5 > N2 > N3 > N1 > N4 > N6 > N7 > N8`. Se ne
mostra **uno solo**, il più urgente. Dopo 3 ignoramenti lo stesso tipo non
compare più: il limite è per tipo, non globale, così un utente che ignora
«piove» non perde anche «il bus è passato».

## Cosa manca (dichiarato, non nascosto)

- **Collegato finora**: dopo che `caricaLiveTappe` legge i ritardi,
  `app.js` chiama `rischioCambi` e `affidabilitaRealtime`, il riepilogo scrive
  «in orario / qualche ritardo / ritardi in corso» e il dettaglio marca i
  cambi con «a rischio» e il motivo. La parola compare solo se `coperturaRealtime`
  dice che **tutte** le corse bus hanno un ritardo noto: con una risposta sola
  su tre il riepilogo scrive «dato parziale: 1 di 3 corse» e non un verdetto.
  Se il viaggio include un treno la parola è qualificata — «bus in orario»,
  «ritardi sui bus» — perché per i treni non esiste un feed live.
  Ogni ritardo letto diventa un'osservazione con `registraOsservazione`
  (linea, giorno della settimana, ora, ritardo; niente posizione), tenuta in
  `tperzc_storico_ritardi_v3`. Una corsa viene registrata una volta sola, anche
  se la interroghiamo da due punti.
- **Stima dallo storico**: se HelloBus non risponde per una corsa bus,
  `statisticheLinea` cerca la mediana della stessa linea nella stessa fascia
  oraria, poi nello stesso giorno, poi in tutto lo storico. La stima compare
  solo con almeno 5 osservazioni e sopra i 2 minuti, ed è **dichiarata** —
  «+3 min stimati» nel dettaglio, «ritardo stimato» nel riepilogo. Non entra
  nei conti di copertura, affidabilità o cambi a rischio: quelli restano solo
  sui dati live.
  `intelligenza.js` è nel precache del service worker.
- **Non ancora collegato**: `punteggio` di `routing.js` non usa
  `punteggioCombinato`, quindi i pesi non cambiano ancora *quale* percorso
  viene scelto, solo come viene raccontato. Restano fuori anche
  `ritardoCascata` sull'arrivo finale, la riga del suggerimento e la cache
  dei risultati.
- **Verifica**: il ritardo live e la stima sono coperti da test end-to-end con
  HelloBus simulato e percorso fissato; non sono stati visti con HelloBus reale,
  che in prova non produce ritardi controllabili.
- **Eventi e disruzioni**: `disturboAttivo` e `toccaDisturbo` leggono una lista
  che qualcuno deve fornire. Non esiste `data/eventi.json`: **non ho inventato
  eventi**, partite o scioperi.
- **Livello 5 nella UI**: la scelta del suggerimento è implementata, la riga
  gialla in cima al percorso no (`htmlSuggerimenti` esiste ma parla d'altro).
- **Cache dei risultati (7.3)** e **criterio appreso (5.2)**: non implementati.
- I test di precisione contro Google Maps (§9.2) non sono eseguibili da qui:
  Google Maps non offre un'API pubblica gratuita per confrontare i tempi.

## Test

`tests/intelligenza.test.js` copre i sette casi della Parte 9.1 più la
degradazione: ritardo a cascata, cambio perso, pareggio rotto
dall'affidabilità, nessuna coordinata nello storico, meteo che penalizza solo
il cammino lungo, un solo suggerimento, ignorati che non tornano, e punteggio
base quando tutti i servizi sono giù.
