#!/usr/bin/env python3
"""
converti-fermate-autobus.py

Converte il file ufficiale "tper-fermate-autobus.json" (dataset open data
della Regione Emilia-Romagna / TPER) nei due file usati dall'app:

  - data/fermate.json              (elenco fermate con nome, zona, coordinate, indirizzo breve)
  - data/linee-per-fermata.json    (linee che servono ciascuna fermata)

Il file sorgente contiene un record per ogni combinazione fermata+linea
(quindi la stessa fermata compare più volte, una per ogni linea che ci passa).
Questo script raggruppa i record per "codice" fermata e produce i due file
puliti che l'app si aspetta.

REQUISITI: solo Python 3 (incluso di default su Mac e Linux; su Windows si
scarica gratis da python.org). Nessuna libreria esterna da installare:
usa solo moduli nativi (json, os, sys, datetime).

USO:
    python3 converti-fermate-autobus.py percorso/tper-fermate-autobus.json

Di default scrive in ./data/fermate.json e ./data/linee-per-fermata.json
(eseguire lo script dalla cartella principale del progetto, oppure passare
i percorsi di output come secondo e terzo argomento):

    python3 converti-fermate-autobus.py tper-fermate-autobus.json data/fermate.json data/linee-per-fermata.json

NOTA SULLE STAZIONI FERROVIARIE: il dataset TPER riguarda solo gli autobus.
Le stazioni ferroviarie qui sotto sono inserite a mano (elenco STAZIONI_TRENO
più in basso): aggiungi o correggi quella lista se mancano stazioni che ti
servono, oppure procurati un dataset ferroviario separato (es. da Trenitalia
Tper o OpenStreetMap) e integralo allo stesso modo.
"""

import json
import re
import sys
import os

PREPOSIZIONI_MINUSCOLE = {
    "di", "del", "dello", "della", "dei", "degli", "delle", "da", "dal", "dallo",
    "dalla", "dai", "dagli", "dalle", "in", "nel", "nello", "nella", "nei",
    "negli", "nelle", "a", "al", "allo", "alla", "ai", "agli", "alle", "e", "o",
    "con", "su", "per", "tra", "fra"
}

# Stazioni ferroviarie curate a mano: il dataset bus TPER non le contiene.
# Modifica/estendi liberamente questa lista.
STAZIONI_TRENO = [
    {"id": "TRN001", "nome": "Bologna - Stazione Centrale", "tipo": "entrambi", "zona": "500", "lat": 44.506234, "lon": 11.342267},
    {"id": "TRN002", "nome": "Corticella - Stazione", "tipo": "treno", "zona": "504", "lat": 44.5390, "lon": 11.3330},
    {"id": "TRN003", "nome": "San Lazzaro - Stazione", "tipo": "treno", "zona": "501", "lat": 44.4780, "lon": 11.3900},
    {"id": "TRN004", "nome": "Casalecchio di Reno - Garibaldi", "tipo": "treno", "zona": "507", "lat": 44.4827287, "lon": 11.2727053},
    {"id": "TRN005", "nome": "Castel Maggiore - Stazione", "tipo": "treno", "zona": "531", "lat": 44.5660, "lon": 11.3600},
    {"id": "TRN006", "nome": "Bentivoglio - Stazione", "tipo": "treno", "zona": "561", "lat": 44.6150, "lon": 11.4260},
    {"id": "TRN007", "nome": "Sasso Marconi - Stazione", "tipo": "treno", "zona": "581", "lat": 44.3949461, "lon": 11.2543220},
    {"id": "TRN008", "nome": "Marzabotto - Stazione", "tipo": "treno", "zona": "582", "lat": 44.3412514, "lon": 11.2073990},
    {"id": "TRN009", "nome": "Vignola - Stazione", "tipo": "treno", "zona": "591", "lat": 44.4817784, "lon": 11.0084565},
    {"id": "TRN010", "nome": "Imola - Stazione", "tipo": "treno", "zona": "510", "lat": 44.359375, "lon": 11.718726},
    {"id": "TRN011", "nome": "Pianoro - Stazione", "tipo": "treno", "zona": "509", "lat": 44.380563, "lon": 11.340680},
    {"id": "TRN012", "nome": "Bologna - Borgo Panigale", "tipo": "treno", "zona": "500", "lat": 44.5151514, "lon": 11.2849781},
    {"id": "TRN013", "nome": "Casteldebole - Stazione", "tipo": "treno", "zona": "500", "lat": 44.5035645, "lon": 11.2745798},
    {"id": "TRN014", "nome": "Casalecchio di Reno - Ceretolo", "tipo": "treno", "zona": "507", "lat": 44.4814630, "lon": 11.2629212},
    {"id": "TRN015", "nome": "Casalecchio di Reno - Palasport", "tipo": "treno", "zona": "507", "lat": 44.4846921, "lon": 11.2475839},
    {"id": "TRN016", "nome": "Riale - Stazione", "tipo": "treno", "zona": "571", "lat": 44.4854155, "lon": 11.2410254},
    {"id": "TRN017", "nome": "Pilastrino - Stazione", "tipo": "treno", "zona": "571", "lat": 44.4882260, "lon": 11.2294746},
    {"id": "TRN018", "nome": "Zola Predosa - Zola Centro", "tipo": "treno", "zona": "571", "lat": 44.4925206, "lon": 11.2181143},
    {"id": "TRN019", "nome": "Zola Predosa - Zola Chiesa", "tipo": "treno", "zona": "571", "lat": 44.4941412, "lon": 11.2094261},
    {"id": "TRN020", "nome": "Zola Predosa - Ponte Ronca", "tipo": "treno", "zona": "571", "lat": 44.5021261, "lon": 11.1919396},
    {"id": "TRN021", "nome": "Zola Predosa - Via Lunga", "tipo": "treno", "zona": "558", "lat": 44.5098660, "lon": 11.1692096},
    {"id": "TRN022", "nome": "Crespellano - Stazione", "tipo": "treno", "zona": "558", "lat": 44.5122597, "lon": 11.1298768},
    {"id": "TRN023", "nome": "Muffa - Stazione", "tipo": "treno", "zona": "558", "lat": 44.5104499, "lon": 11.1094040},
    {"id": "TRN024", "nome": "Bazzano - Stazione", "tipo": "treno", "zona": "558", "lat": 44.5086013, "lon": 11.0782074},
    {"id": "TRN025", "nome": "Savignano sul Panaro - Mulino", "tipo": "treno", "zona": "444", "lat": 44.4941380, "lon": 11.0474736},
    {"id": "TRN026", "nome": "Savignano sul Panaro - Centro", "tipo": "treno", "zona": "444", "lat": 44.4832914, "lon": 11.0328685},
    {"id": "TRN027", "nome": "Casalecchio di Reno - Stazione", "tipo": "treno", "zona": "507", "lat": 44.4743616, "lon": 11.2762664},
    {"id": "TRN028", "nome": "Borgonuovo - Stazione", "tipo": "treno", "zona": "581", "lat": 44.4436713, "lon": 11.2751224},
    {"id": "TRN029", "nome": "Pontecchio Marconi - Stazione", "tipo": "treno", "zona": "581", "lat": 44.4231153, "lon": 11.2692588},
    {"id": "TRN030", "nome": "Lama di Reno - Stazione", "tipo": "treno", "zona": "582", "lat": 44.3628324, "lon": 11.2144490},
    {"id": "TRN031", "nome": "Pian di Venola - Stazione", "tipo": "treno", "zona": "582", "lat": 44.3331327, "lon": 11.1902030},
    {"id": "TRN032", "nome": "Pioppe di Salvaro - Stazione", "tipo": "treno", "zona": "569", "lat": 44.3107789, "lon": 11.1619130},
    {"id": "TRN033", "nome": "Vergato - Stazione", "tipo": "treno", "zona": "569", "lat": 44.2828972, "lon": 11.1144021},
    {"id": "TRN034", "nome": "Carbona - Stazione", "tipo": "treno", "zona": "570", "lat": 44.2470852, "lon": 11.0963833},
    {"id": "TRN035", "nome": "Riola - Stazione", "tipo": "treno", "zona": "570", "lat": 44.2298903, "lon": 11.0535580},
    {"id": "TRN036", "nome": "Silla - Stazione", "tipo": "treno", "zona": "576", "lat": 44.1776897, "lon": 10.9806594},
    {"id": "TRN037", "nome": "Porretta Terme - Stazione", "tipo": "treno", "zona": "573", "lat": 44.1559659, "lon": 10.9781072},
    {"id": "TRN038", "nome": "Bologna - San Vitale", "tipo": "treno", "zona": "500", "lat": 44.4960280, "lon": 11.3730902},
    {"id": "TRN039", "nome": "Bologna - Mazzini", "tipo": "treno", "zona": "500", "lat": 44.4826161, "lon": 11.3762573},
    {"id": "TRN040", "nome": "Bologna - San Ruffillo", "tipo": "treno", "zona": "500", "lat": 44.4626716, "lon": 11.3730831},
    {"id": "TRN041", "nome": "Rastignano - Stazione", "tipo": "treno", "zona": "509", "lat": 44.4432202, "lon": 11.3574417},
    {"id": "TRN042", "nome": "Musiano - Pian di Macina", "tipo": "treno", "zona": "509", "lat": 44.4009170, "lon": 11.3439518},
]


def to_title_it(testo):
    """Converte 'BOLOGNA - CASE GHEDINI' in 'Bologna - Case Ghedini',
    tenendo minuscole le preposizioni italiane come in 'Anzola dell'Emilia'."""
    testo = testo.strip().replace('`', "'").replace('\u2019', "'")
    parole = testo.lower().split(' ')
    risultato = []
    for i, p in enumerate(parole):
        if p == '':
            continue
        if "'" in p:
            pezzi = p.split("'")
            pezzi = [pz.capitalize() for pz in pezzi]
            parola_fmt = "'".join(pezzi)
        elif p in PREPOSIZIONI_MINUSCOLE and i != 0:
            parola_fmt = p
        else:
            parola_fmt = p.capitalize()
        risultato.append(parola_fmt)
    return ' '.join(risultato)


# Il campo "ubicazione" del dataset è un indirizzo, ma a volte porta anche
# note di navigazione ("10 metri dopo il 34", "fronte cabina Enel", "poco
# prima della rotatoria"): qui si tiene solo la parte utile a capire dove si
# trova la fermata.
NOTE_INDIRIZZO = re.compile(
    r"(\b\d+\s?(?:metri|metro|mt|m)\b"
    r"|\b(?:prima|dopo)\b"
    r"|\b(?:incr|incrocio|rotatoria|rotonda|svincolo)\b"
    r"|\b(?:cabina|distributore|semaforo|parcheggio|parch\.|ingresso|cancello|palo)\b"
    r"|\b(?:lato|corsia|stallo|manovra|in testa)\b"
    r"|\b(?:fronte|davanti|presso|angolo|altezza|prossimit\w*|dirimpello)\b"
    r"|\()",
    re.IGNORECASE,
)
CODA_INDIRIZZO = re.compile(
    r"\b(?:fr|fronte|di|del|dello|della|dei|degli|delle|con|e|a|al|allo|alla|ai|su|per|in|poco|circa|vicino|lato|corsia|parch|strada|interna|testa|della|dello)\b[\s,.;-]*$",
    re.IGNORECASE,
)
CIVICO_INDIRIZZO = re.compile(r"\bCIV\.?\s*", re.IGNORECASE)


def _parola_indirizzo(parola):
    """Maiuscole/minuscole di una parola dell'indirizzo, senza toccare i civici."""
    if any(carattere.isdigit() for carattere in parola):
        return parola.upper()
    basso = parola.lower()
    basso = re.sub(r"(^|[.'\s])([a-z\u00e0-\u00ff])",
                   lambda m: m.group(1) + m.group(2).upper(), basso)
    return basso


def titolo_indirizzo(testo):
    parole = []
    for i, parola in enumerate(testo.split(' ')):
        if not parola:
            continue
        if i > 0 and parola.lower().strip(',.') in PREPOSIZIONI_MINUSCOLE:
            parole.append(parola.lower())
        else:
            parole.append(_parola_indirizzo(parola))
    return ' '.join(parole)


def pulisci_indirizzo(testo):
    """Indirizzo breve della fermata, oppure None se il dato non c'è."""
    pulito = re.sub(r"\s+", " ", (testo or '').strip())
    if not pulito or pulito.upper() in {'N/A', 'NA', 'NULL', '-'}:
        return None
    pulito = CIVICO_INDIRIZZO.sub(' ', pulito)
    # "Rotonda ..." all'inizio è il nome del luogo, non una nota: si cerca il
    # primo marcatore che non sia in testa alla stringa.
    for taglio in NOTE_INDIRIZZO.finditer(pulito):
        if taglio.start() >= 3:
            pulito = pulito[:taglio.start()]
            break
    pulito = re.sub(r"\s+", " ", pulito).strip(' ,.;-/')
    while True:
        senza_coda = CODA_INDIRIZZO.sub('', pulito).strip(' ,.;-/')
        if senza_coda == pulito:
            break
        pulito = senza_coda
    if len(pulito) < 3:
        return None
    return titolo_indirizzo(pulito)


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 converti-fermate-autobus.py percorso/tper-fermate-autobus.json [out_fermate.json] [out_linee.json]")
        sys.exit(1)

    percorso_input = sys.argv[1]
    percorso_fermate = sys.argv[2] if len(sys.argv) > 2 else os.path.join('data', 'fermate.json')
    percorso_linee = sys.argv[3] if len(sys.argv) > 3 else os.path.join('data', 'linee-per-fermata.json')

    if not os.path.exists(percorso_input):
        print(f"File non trovato: {percorso_input}")
        sys.exit(1)

    with open(percorso_input, encoding='utf-8') as f:
        dati_grezzi = json.load(f)

    fermate_per_codice = {}
    linee_per_codice = {}
    scartate_zona_assente = 0

    for rec in dati_grezzi:
        codice = str(rec.get('codice'))
        zona = rec.get('codice_zona')
        if not zona:
            scartate_zona_assente += 1
            continue

        if codice not in fermate_per_codice:
            comune = to_title_it(rec.get('comune', ''))
            denom_grezza = (rec.get('denominazione') or '').rstrip('@').strip()
            denom = to_title_it(denom_grezza)
            nome = f"{comune} - {denom}" if comune and denom else (comune or denom)
            geo = rec.get('geopoint') or {}
            fermate_per_codice[codice] = {
                "id": codice,
                "nome": nome,
                "tipo": "bus",
                "zona": str(zona),
                "lat": geo.get('lat'),
                "lon": geo.get('lon'),
            }
            indirizzo = pulisci_indirizzo(rec.get('ubicazione'))
            if indirizzo:
                fermate_per_codice[codice]["indirizzo"] = indirizzo
            linee_per_codice[codice] = set()

        linea = rec.get('codice_linea')
        if linea:
            linee_per_codice[codice].add(str(linea))

    fermate_finali = list(fermate_per_codice.values()) + STAZIONI_TRENO
    fermate_finali.sort(key=lambda f: f['nome'])

    linee_finali = {codice: sorted(linee) for codice, linee in linee_per_codice.items() if linee}

    from datetime import date
    oggi = date.today().isoformat()

    out_fermate = {
        "aggiornato": oggi,
        "fonte": "Dataset ufficiale TPER (open data) convertito con converti-fermate-autobus.py; stazioni ferroviarie integrate manualmente",
        "fermate": fermate_finali,
    }
    out_linee = {
        "aggiornato": oggi,
        "fonte": "Generato dal dataset ufficiale TPER fermate-autobus (campo codice_linea)",
        "linee": linee_finali,
    }

    os.makedirs(os.path.dirname(percorso_fermate) or '.', exist_ok=True)
    os.makedirs(os.path.dirname(percorso_linee) or '.', exist_ok=True)

    with open(percorso_fermate, 'w', encoding='utf-8') as f:
        json.dump(out_fermate, f, ensure_ascii=False, indent=2)
    with open(percorso_linee, 'w', encoding='utf-8') as f:
        json.dump(out_linee, f, ensure_ascii=False, indent=2)

    print(f"Fatto. {len(fermate_finali)} fermate scritte in {percorso_fermate}")
    print(f"Linee per {len(linee_finali)} fermate scritte in {percorso_linee}")
    if scartate_zona_assente:
        print(f"({scartate_zona_assente} record scartati perché privi di zona tariffaria)")


if __name__ == '__main__':
    main()
