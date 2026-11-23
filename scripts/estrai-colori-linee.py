#!/usr/bin/env python3
"""Colori ufficiali delle linee TPER per la scheda viaggio e la mappa.

Legge il file routes.txt del feed GTFS TPER e scrive data/linee-colori.json:
per ogni numero di linea il colore della linea (route_color) e quello del
testo (route_text_color), come pubblicati da TPER.

Uso:
  python3 scripts/estrai-colori-linee.py percorso/gtfs/routes.txt [data/linee-colori.json]

Il formato in uscita è volutamente minimale: l'app lo carica una volta sola e
lo usa sia per il badge della scheda viaggio sia per il colore del tracciato.
"""

import csv
import json
import os
import sys
from collections import Counter
from datetime import date


def colore(valore, predefinito):
    """Normalizza un colore GTFS in '#rrggbb' (l'app vuole il cancelletto)."""
    testo = (valore or '').strip().lstrip('#')
    if len(testo) == 3:
        testo = ''.join(carattere * 2 for carattere in testo)
    if len(testo) != 6:
        return predefinito
    try:
        int(testo, 16)
    except ValueError:
        return predefinito
    return '#' + testo.lower()


def main():
    if len(sys.argv) < 2:
        print('Uso: python3 scripts/estrai-colori-linee.py percorso/routes.txt [data/linee-colori.json]')
        sys.exit(1)
    sorgente = sys.argv[1]
    uscita = sys.argv[2] if len(sys.argv) > 2 else os.path.join('data', 'linee-colori.json')
    if not os.path.exists(sorgente):
        print('File non trovato: ' + sorgente)
        sys.exit(1)

    # Una linea può comparire su più route_id (varianti di percorso): si conta
    # quale colore ricorre di più e si tiene quello, senza inventare sfumature.
    conteggi = {}
    ordine = []
    righe = 0
    with open(sorgente, newline='', encoding='utf-8-sig') as file:
        for riga in csv.DictReader(file):
            nome = (riga.get('route_short_name') or '').strip().strip('"')
            if not nome:
                continue
            righe += 1
            sfondo = colore(riga.get('route_color'), '')
            testo = colore(riga.get('route_text_color'), '')
            if not sfondo:
                continue
            if nome not in conteggi:
                conteggi[nome] = Counter()
                ordine.append(nome)
            conteggi[nome][(sfondo, testo)] += 1

    linee = {}
    conflitti = 0
    for nome in ordine:
        scelte = conteggi[nome]
        if len(scelte) > 1:
            conflitti += 1
        (sfondo, testo), _ = scelte.most_common(1)[0]
        linee[nome] = [sfondo, testo or '#ffffff']

    dataset = {
        'aggiornato': date.today().isoformat(),
        'fonte': 'GTFS TPER routes.txt (route_color / route_text_color)',
        'linee': linee,
    }
    os.makedirs(os.path.dirname(uscita) or '.', exist_ok=True)
    with open(uscita, 'w', encoding='utf-8') as file:
        json.dump(dataset, file, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    print('Righe routes.txt: ' + str(righe))
    print('Linee con colore: ' + str(len(linee)) + ' (' + str(conflitti) + ' con più colori, tenuto il più frequente)')
    print('Scritto ' + uscita + ' · ' + str(round(os.path.getsize(uscita) / 1024, 1)) + ' KB')


if __name__ == '__main__':
    main()
