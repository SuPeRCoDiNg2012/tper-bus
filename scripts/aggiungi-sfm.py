#!/usr/bin/env python3
"""
aggiungi-sfm.py

Aggiunge al dataset le linee ferroviarie suburbane SFM di Bologna leggendo gli
orari ufficiali SFMBO (PDF), non un GTFS ferroviario che non esiste:

  S1A  Porretta Terme – Bologna Centrale – Pianoro
  S1B  Bologna Centrale – San Benedetto Val di Sambro
  S2B  Bologna Centrale – Portomaggiore (oggi bus sostitutivo)
  S3   Bologna Centrale – Poggio Rusco
  S4A  Bologna Centrale – Ferrara
  S4B  Bologna Centrale – Imola
  S5   Bologna Centrale – Modena

S2A è già importata da `aggiungi-treni-locali.js` e non viene toccata.

USO
  python3 scripts/aggiungi-sfm.py [cartella-pdf]

Senza cartella scarica i PDF in `.tmp-sfm/pdf`. Richiede PyMuPDF
(`python3 -m pip install pymupdf`). Le corse con orari non monotoni o sequenze
incomplete vengono scartate: meglio una linea in meno che un orario inventato.
"""

import datetime
import json
import math
import os
import re
import sys
import urllib.request
import gzip

try:
    import pymupdf
except ImportError:  # pragma: no cover
    sys.exit("Errore: serve PyMuPDF (python3 -m pip install pymupdf)")

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARTELLA_PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RADICE, ".tmp-sfm", "pdf")
FILE_ORARI = os.path.join(RADICE, "data", "orari.json")
FILE_TRACCIATI = os.path.join(RADICE, "data", "tracciati.json")
FILE_FERMATE = os.path.join(RADICE, "data", "fermate.json")
FILE_LINEE = os.path.join(RADICE, "data", "linee-per-fermata.json")

PDF = {
    "S1": ("S1_Porretta_Bologna_Pianoro.pdf",
           "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S1_Porretta-Bologna-Pianoro.pdf"),
    "S1B": ("S1B_San_Benedetto_VS_Bologna_C.pdf",
            "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S1B_Bologna_-_S._Benedetto_VDS.pdf"),
    "S2B": ("S2B_Portomaggiore-Bologna_C.pdf",
            "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S2B_Bologna-Portomaggiore.pdf"),
    "S3": ("S3_Poggio_Rusco-Bologna_C.pdf",
           "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S3_Bologna-Poggio_Rusco.pdf"),
    "S4A": ("S4A_Ferrara-Bologna_C.pdf",
            "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S4A_Bologna-Ferrara.pdf"),
    "S4B": ("S4B_Imola-Bologna_C.pdf",
            "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S4B_Bologna-Imola.pdf"),
    "S5": ("S5_Modena_-Bologna_C.pdf",
           "https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S5_Bologna-Modena.pdf"),
}

# Nomi delle fermate come compaiono nei PDF e ID già presenti nel dataset.
STAZIONI = {
    "Bologna Centrale": ("TRN001", "Bologna - Stazione Centrale", 44.506234, 11.342267),
    "Bologna S. Vitale": ("TRN038", "Bologna - San Vitale", 44.496028, 11.3730902),
    "Bologna Mazzini": ("TRN039", "Bologna - Mazzini", 44.4826161, 11.3762573),
    "Bologna S. Ruffillo": ("TRN040", "Bologna - San Ruffillo", 44.4626716, 11.3730831),
    "Rastignano": ("TRN041", "Rastignano - Stazione", 44.4432202, 11.3574417),
    "Musiano-Pian di M.": ("TRN042", "Musiano - Pian di Macina", 44.400917, 11.3439518),
    "Pianoro": ("TRN011", "Pianoro - Stazione", 44.3805968, 11.3407395),
    "Monzuno-Vado": ("TRN062", "Monzuno - Vado", 44.3221925, 11.2623979),
    "Grizzana": ("TRN063", "Grizzana - Stazione", 44.2582781, 11.1812461),
    "S.Benedetto S.-C.P.": ("TRN064", "San Benedetto Val di Sambro - Castiglione", 44.2162142, 11.1896065),

    "Bologna Borgo Panigale": ("TRN012", "Bologna - Borgo Panigale", 44.5151514, 11.2849781),
    "Casteldebole": ("TRN013", "Casteldebole - Stazione", 44.5151514, 11.2849781),
    "Casalecchio Garibaldi": ("TRN004", "Casalecchio di Reno - Garibaldi", 44.4827287, 11.2727053),
    "Casalecchio di Reno": ("TRN027", "Casalecchio di Reno - Stazione", 44.4743616, 11.2762664),
    "Borgonuovo": ("TRN028", "Borgonuovo - Stazione", 44.4436713, 11.2751224),
    "Pontecchio Marconi": ("TRN029", "Pontecchio Marconi - Stazione", 44.4231444, 11.2692971),
    "Sasso Marconi": ("TRN007", "Sasso Marconi - Stazione", 44.3949767, 11.2542794),
    "Lama di Reno": ("TRN030", "Lama di Reno - Stazione", 44.3629121, 11.2143023),
    "Marzabotto": ("TRN008", "Marzabotto - Stazione", 44.3412514, 11.207399),
    "Pian di Venola": ("TRN031", "Pian di Venola - Stazione", 44.3331145, 11.1902266),
    "Pioppe di Salvaro": ("TRN032", "Pioppe di Salvaro - Stazione", 44.3107789, 11.161913),
    "Vergato": ("TRN033", "Vergato - Stazione", 44.2829511, 11.1144287),
    "Carbona": ("TRN034", "Carbona - Stazione", 44.2470591, 11.0963832),
    "Riola": ("TRN035", "Riola - Stazione", 44.2298903, 11.053558),
    "Silla": ("TRN036", "Silla - Stazione", 44.201, 11.018),
    "Porretta Terme": ("TRN037", "Porretta Terme - Stazione", 44.1559659, 10.9781072),

    "Calderara-Bargellino": ("TRN050", "Calderara - Bargellino", 44.5442561, 11.2673575),
    "Osteria Nuova": ("TRN051", "Osteria Nuova - Stazione", 44.5849298, 11.2351638),
    "S. Giovanni in Persiceto": ("TRN052", "San Giovanni in Persiceto - Stazione", 44.6431931, 11.1894015),
    "Crevalcore": ("TRN053", "Crevalcore - Stazione", 44.7191154, 11.1525029),
    "Camposanto": ("TRN054", "Camposanto - Stazione", 44.7883675, 11.1431024),
    "S. Felice sul Panaro": ("TRN055", "San Felice sul Panaro - Stazione", 44.8345844, 11.1404244),
    "Mirandola": ("TRN056", "Mirandola - Stazione", 44.8916681, 11.1118719),
    "Poggio Rusco": ("TRN057", "Poggio Rusco - Stazione", 44.9818151, 11.1244434),

    "S. Pietro in Casale": ("TRN045", "San Pietro in Casale - Stazione", 44.6979493, 11.4047318),
    "Ferrara": ("TRN046", "Ferrara - Stazione", 44.8428777, 11.6039031),

    "San Lazzaro di Savena": ("TRN003", "San Lazzaro di Savena - Stazione", 44.478, 11.408),
    "Ozzano dell'Emilia": ("TRN047", "Ozzano dell'Emilia - Stazione", 44.4507733, 11.4875419),
    "Varignana": ("TRN048", "Varignana - Stazione", 44.4369684, 11.5225689),
    "Castel S. Pietro Terme": ("TRN049", "Castel San Pietro Terme - Stazione", 44.407365, 11.5977165),
    "Imola": ("TRN010", "Imola - Stazione", 44.359375, 11.718726),

    "Anzola dell'Emilia": ("TRN058", "Anzola dell'Emilia - Stazione", 44.5509657, 11.1966226),
    "Samoggia": ("TRN059", "Samoggia - Stazione", 44.5673223, 11.1462846),
    "Castelfranco d'Emilia": ("TRN060", "Castelfranco Emilia - Stazione", 44.5974173, 11.0565579),
    "Modena": ("TRN061", "Modena - Stazione", 44.6543308, 10.9305293),

    "Bologna C.le Autostazione": ("TRN065", "Bologna - Autostazione", 44.5043, 11.3412),
    "Bologna Zanolini": ("TRN066", "Bologna - Zanolini", 44.4972, 11.359371),
    "Bologna Rimesse": ("TRN067", "Bologna - Rimesse", 44.493416, 11.373431),
    "Bologna S. Rita": ("TRN068", "Bologna - Santa Rita", 44.493502, 11.383132),
    "Bologna Via Larga": ("TRN069", "Bologna - Via Larga", 44.4970758, 11.3932474),
    "Bologna Roveri": ("TRN070", "Bologna - Roveri", 44.497562, 11.410567),
    "Cà dell'Orbo": ("TRN071", "Cà dell'Orbo - Stazione", 44.500714, 11.433867),
    "Castenaso Stellina": ("TRN072", "Castenaso - Stellina", 44.504963, 11.457392),
    "Castenaso": ("TRN073", "Castenaso - Stazione", 44.5034266, 11.4721437),
    "Budrio stazione": ("TRN074", "Budrio - Stazione", 44.5330286, 11.5286135),
    "Budrio Centro": ("TRN075", "Budrio - Centro", 44.540968, 11.527321),
    "Mezzolara": ("TRN076", "Mezzolara - Stazione", 44.587687, 11.565022),
    "Guarda": ("TRN077", "Guarda - Stazione", 44.6105736, 11.6220614),
    "Molinella": ("TRN078", "Molinella - Stazione", 44.6273007, 11.6683575),
    "Consandolo": ("TRN079", "Consandolo - Stazione", 44.6638662, 11.7768558),
    "Portomaggiore": ("TRN080", "Portomaggiore - Stazione", 44.6968307, 11.799931),
}

LINEE = [
    {
        "nome": "S1A", "tipo": 2, "pdf": "S1", "minimo": 15,
        "fermate": [
            "Bologna Centrale", "Bologna Borgo Panigale", "Casteldebole", "Casalecchio Garibaldi",
            "Casalecchio di Reno", "Borgonuovo", "Pontecchio Marconi", "Sasso Marconi",
            "Lama di Reno", "Marzabotto", "Pian di Venola", "Pioppe di Salvaro", "Vergato",
            "Carbona", "Riola", "Silla", "Porretta Terme",
        ],
        "capolinea": ("Bologna Centrale", "Porretta Terme"),
    },
    {
        "nome": "S1B", "tipo": 2, "pdf": "S1B", "minimo": 9,
        "fermate": [
            "Bologna Centrale", "Bologna S. Vitale", "Bologna Mazzini", "Bologna S. Ruffillo",
            "Rastignano", "Musiano-Pian di M.", "Pianoro", "Monzuno-Vado", "Grizzana",
            "S.Benedetto S.-C.P.",
        ],
        "capolinea": ("Bologna Centrale", "S.Benedetto S.-C.P."),
    },
    {
        "nome": "S2B", "tipo": 3, "pdf": "S2B", "minimo": 6, "codici": "tutti",
        "fermate": [
            "Bologna C.le Autostazione", "Bologna Zanolini", "Bologna Rimesse", "Bologna S. Rita",
            "Bologna Via Larga", "Bologna Roveri", "Cà dell'Orbo", "Castenaso Stellina",
            "Castenaso", "Budrio stazione", "Budrio Centro", "Mezzolara", "Guarda", "Molinella",
            "Consandolo", "Portomaggiore",
        ],
        "capolinea": None,
    },
    {
        "nome": "S3", "tipo": 2, "pdf": "S3", "minimo": 7,
        "fermate": [
            "Bologna Centrale", "Calderara-Bargellino", "Osteria Nuova", "S. Giovanni in Persiceto",
            "Crevalcore", "Camposanto", "S. Felice sul Panaro", "Mirandola", "Poggio Rusco",
        ],
        "capolinea": ("Bologna Centrale", "Poggio Rusco"),
    },
    {
        "nome": "S4A", "tipo": 2, "pdf": "S4A", "minimo": 3,
        "fermate": ["Bologna Centrale", "Calderara-Bargellino", "Osteria Nuova", "S. Pietro in Casale", "Ferrara"],
        "capolinea": ("Bologna Centrale", "Ferrara"),
    },
    {
        "nome": "S4B", "tipo": 2, "pdf": "S4B", "minimo": 5,
        "fermate": [
            "Bologna Centrale", "Bologna S. Vitale", "San Lazzaro di Savena", "Ozzano dell'Emilia",
            "Varignana", "Castel S. Pietro Terme", "Imola",
        ],
        "capolinea": ("Bologna Centrale", "Imola"),
    },
    {
        "nome": "S5", "tipo": 2, "pdf": "S5", "minimo": 4,
        "fermate": ["Bologna Centrale", "Anzola dell'Emilia", "Samoggia", "Castelfranco d'Emilia", "Modena"],
        "capolinea": ("Bologna Centrale", "Modena"),
        "obbligatorie": ("Anzola dell'Emilia", "Samoggia"),
    },
]

SERVIZIO = [127, 20260614, 20261212]


def normalizza(testo):
    return re.sub(r"\s+", " ", str(testo or "").replace("\x1a", "").replace("\x0c", "").replace("\n", " ")).strip()


def orario_minuti(cella):
    trovato = re.search(r"(?<!\d)(\d{1,2})[.:](\d{2})(?!\d)", str(cella or ""))
    if not trovato:
        return None
    return int(trovato.group(1)) * 60 + int(trovato.group(2))


def codice_treno(cella):
    testo = str(cella or "").replace("\n", " ")
    trovato = re.search(r"\b(B?\d{4,6})\b", testo)
    return trovato.group(1) if trovato else None


def scarica_pdf(nome_file, url):
    os.makedirs(CARTELLA_PDF, exist_ok=True)
    percorso = os.path.join(CARTELLA_PDF, nome_file)
    if os.path.exists(percorso) and os.path.getsize(percorso) > 10000:
        return percorso
    print("  scarico " + nome_file)
    richiesta = urllib.request.Request(url, headers={"User-Agent": "MuoviBologna/1.0 (import SFM)"})
    with urllib.request.urlopen(richiesta, timeout=60) as risposta, open(percorso, "wb") as uscita:
        uscita.write(risposta.read())
    return percorso


def estrai(pdf, fermate, minimo, capolinea, obbligatorie=(), codici="treni"):
    """Restituisce {codice: [(fermata, minuti), ...]} dalle tabelle del PDF."""
    documento = pymupdf.open(pdf)
    corse = {}
    for pagina in documento:
        for tabella in pagina.find_tables().tables:
            righe = tabella.extract()
            if len(righe) < 3:
                continue
            # La colonna delle fermate è quella con più nomi noti nelle prime
            # colonne; i PDF mettono le note a sinistra e gli orari a destra.
            colonna_fermate = max(
                range(min(4, len(righe[0]))),
                key=lambda c: sum(
                    1 for r in righe
                    if len(r) > c and any(normalizza(r[c]).startswith(f) for f in fermate)
                ),
            )
            colonne = []
            for indice, cella in enumerate(righe[0]):
                if indice <= colonna_fermate:
                    continue
                codice = codice_treno(cella)
                if not codice:
                    continue
                if codici == "treni" and codice.startswith("B"):
                    continue
                colonne.append((indice, codice))
            if not colonne:
                continue
            viste = set()
            for riga in righe[1:]:
                if len(riga) <= colonna_fermate:
                    continue
                nome = normalizza(riga[colonna_fermate])
                fermata = next((f for f in fermate if nome.startswith(f)), None)
                if not fermata or fermata in viste:
                    continue
                viste.add(fermata)
                for indice, codice in colonne:
                    if indice >= len(riga):
                        continue
                    minuti = orario_minuti(riga[indice])
                    if minuti is None:
                        continue
                    voce = corse.setdefault(codice, {})
                    # Una corsa può essere spezzata su due tabelle: si tiene
                    # la prima occorrenza e non si sovrascrive con una nota.
                    if fermata not in voce:
                        voce[fermata] = minuti

    risultato = {}
    for codice, per_fermata in corse.items():
        if capolinea and not all(c in per_fermata for c in capolinea):
            continue
        if not all(f in per_fermata for f in obbligatorie):
            continue
        ordinate = sorted(per_fermata.items(), key=lambda voce: voce[1])
        # Dopo mezzanotte gli orari ripartono da 00: il PDF non li usa, ma se
        # succede si continua a contare invece di scartare la corsa.
        normalizzate = []
        giorno = 0
        precedente = -1
        for fermata, minuti in ordinate:
            valore = minuti + giorno * 1440
            if valore < precedente:
                giorno += 1
                valore += 1440
            normalizzate.append((fermata, valore))
            precedente = valore
        if len(normalizzate) < minimo:
            continue
        if any(normalizzate[i][1] <= normalizzate[i - 1][1] for i in range(1, len(normalizzate))):
            continue
        risultato[codice] = normalizzate
    return risultato


def polilinea(punti):
    uscita = ""
    lat_prec = lon_prec = 0
    for lat, lon in punti:
        lat_i = round(lat * 1e5)
        lon_i = round(lon * 1e5)
        # compressione Google polyline
        for valore in (lat_i - lat_prec, lon_i - lon_prec):
            v = ~(valore << 1) if valore < 0 else (valore << 1)
            while v >= 0x20:
                uscita += chr((0x20 | (v & 0x1F)) + 63)
                v >>= 5
            uscita += chr(v + 63)
        lat_prec, lon_prec = lat_i, lon_i
    return uscita


def forma_dritta(sequenza, coordinate):
    """Polilinea interpolata (un punto ogni ~400 m) tra le stazioni."""
    punti = []
    posizioni = []
    for indice, identificativo in enumerate(sequenza):
        lat, lon = coordinate[identificativo]
        if not punti:
            punti.append((lat, lon))
            posizioni.append(0)
            continue
        lat_prec, lon_prec = punti[-1]
        metri = math.hypot((lon - lon_prec) * 111320 * math.cos(math.radians(lat)), (lat - lat_prec) * 111320)
        passi = max(1, int(math.ceil(metri / 250)))
        for passo in range(1, passi + 1):
            punti.append((
                lat_prec + (lat - lat_prec) * passo / passi,
                lon_prec + (lon - lon_prec) * passo / passi,
            ))
        posizioni.append(len(punti) - 1)
    return polilinea(punti), posizioni


def main():
    with open(FILE_ORARI, encoding="utf-8") as file:
        orari = json.load(file)
    with open(FILE_TRACCIATI, encoding="utf-8") as file:
        tracciati = json.load(file)
    with open(FILE_FERMATE, encoding="utf-8") as file:
        fermate_file = json.load(file)
    with open(FILE_LINEE, encoding="utf-8") as file:
        linee_file = json.load(file)
    linee_file.setdefault("linee", {})

    nomi = {linea["nome"] for linea in LINEE}
    vecchie = {i for i, linea in enumerate(orari["linee"]) if linea and linea[0] in nomi}

    # Il GTFS nazionale aveva già alcune corse Bologna–Porretta sotto REG/RV:
    # ora la fonte ufficiale è il PDF SFMBO. Si tolgono quei doppioni, così il
    # percorso mostra S1A e non due orari identici con etichette diverse.
    sostituite = set()
    for i, corsa in enumerate(orari["corse"]):
        if corsa[0] in vecchie:
            continue
        nome_linea = orari["linee"][corsa[0]][0] if corsa[0] < len(orari["linee"]) else ""
        if nome_linea not in ("REG", "RV"):
            continue
        fermate_corsa = [orari["fermate"][corsa[2]]]
        indice = corsa[2]
        for k in range(4, len(corsa), 2):
            indice += corsa[k]
            fermate_corsa.append(orari["fermate"][indice])
        if "TRN037" in fermate_corsa and "TRN001" in fermate_corsa:
            sostituite.add(i)

    if vecchie or sostituite:
        # Riesecuzione: toglie le corse SFM già importate e i doppioni S1 del
        # GTFS nazionale, lasciando intatto tutto il resto (bus, S2A, MEX).
        tenute = [i for i in range(len(orari["corse"])) if i not in sostituite and orari["corse"][i][0] not in vecchie]
        orari["corse"] = [orari["corse"][i] for i in tenute]
        tracciati["corse"] = [tracciati["corse"][i] for i in tenute]

    indice_fermata = {identificativo: i for i, identificativo in enumerate(orari["fermate"])}
    coordinate = {}
    esistenti = {f["id"] for f in fermate_file["fermate"]}
    for nome, (identificativo, etichetta, lat, lon) in STAZIONI.items():
        if identificativo not in esistenti:
            fermate_file["fermate"].append({
                "id": identificativo, "nome": etichetta, "tipo": "treno", "zona": "500", "lat": lat, "lon": lon,
            })
            esistenti.add(identificativo)
        if identificativo not in indice_fermata:
            indice_fermata[identificativo] = len(orari["fermate"])
            orari["fermate"].append(identificativo)
        esistente = next((f for f in fermate_file["fermate"] if f["id"] == identificativo), None)
        coordinate[identificativo] = (esistente["lat"], esistente["lon"]) if esistente else (lat, lon)

    if SERVIZIO not in orari["servizi"]:
        orari["servizi"].append(SERVIZIO)
    indice_servizio = orari["servizi"].index(SERVIZIO)

    forme_per_sequenza = {}
    nuove_corse = []
    nuove_forme = []
    nuove_posizioni = []
    nuove_linee = []
    conteggi = {}

    def aggiungi_corsa(nome_linea, tipo, sequenza, tempi):
        identificativi = [STAZIONI[f][0] for f, _ in sequenza]
        if len(set(identificativi)) != len(identificativi):
            return False
        if len(identificativi) < 2:
            return False
        if nome_linea not in nuove_linee:
            nuove_linee.append(nome_linea)
            conteggi[nome_linea] = 0
        indice_linea = len(orari["linee"]) + nuove_linee.index(nome_linea)
        chiave = tuple(identificativi)
        if chiave not in forme_per_sequenza:
            forma, posizioni = forma_dritta(identificativi, coordinate)
            forme_per_sequenza[chiave] = len(tracciati["forme"]) + len(nuove_forme)
            nuove_forme.append(forma)
            tabella = []
            for fermata, posizione in zip(identificativi, posizioni):
                tabella.extend([indice_fermata[fermata], posizione])
            nuove_posizioni.append(tabella)
        corsa = [indice_linea, indice_servizio, indice_fermata[identificativi[0]], tempi[0] * 60]
        for i in range(1, len(identificativi)):
            corsa.extend([
                indice_fermata[identificativi[i]] - indice_fermata[identificativi[i - 1]],
                (tempi[i] - tempi[i - 1]) * 60,
            ])
        nuove_corse.append(corsa)
        conteggi[nome_linea] += 1
        return True

    for configurazione in LINEE:
        nome_pdf, url = PDF[configurazione["pdf"]]
        percorso = scarica_pdf(nome_pdf, url)
        corse = estrai(
            percorso,
            configurazione["fermate"],
            configurazione["minimo"],
            configurazione["capolinea"],
            configurazione.get("obbligatorie", ()),
            configurazione.get("codici", "treni"),
        )
        for codice in sorted(corse):
            sequenza = corse[codice]
            # La sequenza deve rispettare l'ordine canonico della linea: se il
            # PDF ha un nome ambiguo, la corsa viene scartata invece di essere
            # disegnata fuori percorso.
            ordine = {f: i for i, f in enumerate(configurazione["fermate"])}
            indici = [ordine[f] for f, _ in sequenza]
            if indici != sorted(indici) and indici != sorted(indici, reverse=True):
                continue
            aggiungi_corsa(configurazione["nome"], configurazione["tipo"], sequenza, [t for _, t in sequenza])
        print("  " + configurazione["nome"] + ": " + str(conteggi.get(configurazione["nome"], 0)) + " corse")

    # S1A ha anche il ramo Pianoro: le corse S1B che passano da Pianoro vengono
    # accorciate lì, così la linea S1A copre entrambi i rami senza inventare
    # coincidenze che il PDF non riporta.
    percorso_s1b = os.path.join(CARTELLA_PDF, PDF["S1B"][0])
    if os.path.exists(percorso_s1b):
        corse_s1b = estrai(
            percorso_s1b,
            [f for f in LINEA_S1B_FERMATE],
            9,
            ("Bologna Centrale", "S.Benedetto S.-C.P."),
        )
        for codice in sorted(corse_s1b):
            sequenza = corse_s1b[codice]
            nomi_sequenza = [f for f, _ in sequenza]
            if "Pianoro" not in nomi_sequenza or "Bologna Centrale" not in nomi_sequenza:
                continue
            i_bologna = nomi_sequenza.index("Bologna Centrale")
            i_pianoro = nomi_sequenza.index("Pianoro")
            if i_bologna < i_pianoro:
                ramo = sequenza[i_bologna:i_pianoro + 1]
            else:
                ramo = sequenza[i_pianoro:i_bologna + 1]
            if len(ramo) < 2:
                continue
            aggiungi_corsa("S1A", 2, ramo, [t for _, t in ramo])

    # Le linee S2B sono bus sostitutivi: restano tipo 3, non vengono presentate
    # come treni. Le altre sono tipo 2.
    for nome in nuove_linee:
        orari["linee"].append([nome, 3 if nome == "S2B" else 2])

    orari["corse"].extend(nuove_corse)

    # `nuove_corse` non porta con sé l'indice forma: lo si ricava dalla
    # sequenza compressa, che è l'unica informazione salvata.
    for corsa in nuove_corse:
        fermate_corsa = [orari["fermate"][corsa[2]]]
        indice = corsa[2]
        for k in range(4, len(corsa), 2):
            indice += corsa[k]
            fermate_corsa.append(orari["fermate"][indice])
        chiave = tuple(fermate_corsa)
        tracciati["corse"].append(forme_per_sequenza.get(chiave, -1))

    tracciati["forme"].extend(nuove_forme)
    tracciati["posizioni"].extend(nuove_posizioni)

    # Indice fermata -> linee, per la ricerca e la scheda della fermata.
    per_fermata = {identificativo: set(elenco) for identificativo, elenco in linee_file.get("linee", {}).items()}
    for corsa in nuove_corse:
        nome_linea = orari["linee"][corsa[0]][0]
        indice = corsa[2]
        per_fermata.setdefault(orari["fermate"][indice], set()).add(nome_linea)
        for k in range(4, len(corsa), 2):
            indice += corsa[k]
            per_fermata.setdefault(orari["fermate"][indice], set()).add(nome_linea)
    for identificativo, elenco in list(per_fermata.items()):
        linee_file["linee"][identificativo] = sorted(elenco)

    orari["aggiornato"] = datetime.date.today().isoformat()
    tracciati["aggiornato"] = orari["aggiornato"]
    fermate_file["aggiornato"] = orari["aggiornato"]
    fermate_file["fonte"] = str(fermate_file.get("fonte", "")) + "; orari SFMBO (PDF ufficiali)"
    linee_file["aggiornato"] = orari["aggiornato"]
    linee_file["fonte"] = str(linee_file.get("fonte", "")) + "; linee SFM aggiunte dai PDF SFMBO"

    for percorso, valore, indentato in (
        (FILE_ORARI, orari, False),
        (FILE_TRACCIATI, tracciati, False),
        (FILE_FERMATE, fermate_file, True),
        (FILE_LINEE, linee_file, True),
    ):
        if indentato:
            testo = json.dumps(valore, ensure_ascii=False, indent=2)
            with open(percorso, "rb") as file:
                if b"\r\n" in file.read(200):
                    testo = testo.replace("\n", "\r\n")
            with open(percorso, "w", encoding="utf-8", newline="") as file:
                file.write(testo)
        else:
            with open(percorso, "w", encoding="utf-8") as file:
                json.dump(valore, file, ensure_ascii=False, separators=(",", ":"))
    with open(FILE_ORARI, "rb") as file:
        with gzip.open(FILE_ORARI + ".gz", "wb", compresslevel=9) as uscita:
            uscita.write(file.read())
    with open(FILE_TRACCIATI, "rb") as file:
        with gzip.open(FILE_TRACCIATI + ".gz", "wb", compresslevel=9) as uscita:
            uscita.write(file.read())

    print("Aggiunte " + str(len(nuove_corse)) + " corse SFM, " + str(len(nuove_forme)) + " forme, " + str(len(nuove_linee)) + " linee.")


LINEA_S1B_FERMATE = [
    "Bologna Centrale", "Bologna S. Vitale", "Bologna Mazzini", "Bologna S. Ruffillo",
    "Rastignano", "Musiano-Pian di M.", "Pianoro", "Monzuno-Vado", "Grizzana",
    "S.Benedetto S.-C.P.",
]

if __name__ == "__main__":
    main()
