# Förbättringsbacklog

Genererad av kodbasanalys. Uppdateras löpande.

| # | Åtgärd | Kategori | Status |
|---|--------|----------|--------|
| 1 | Laddningstillstånd + inaktiverade knappar vid fetch | UX | ✅ Klar |
| 2 | Redigeringshistorik i UI (data finns i DB) | UX | ✅ Klar |
| 3 | Paginering i sök-vy (index + avancerad sökning) | UX | ✅ Klar |
| 4 | Dela upp gravplatser.js i moduler | Kod | ✅ Klar |
| 5 | Gemensam utils.js med escapeHtml | Kod | ✅ Klar |
| 6 | Inkonsekvent felhantering i fetch-anrop | Kod | ✅ Klar |
| 7 | Felhantering/loggning i except-block (auth.py:48, auth.py:80) | Kod | ✅ Klar |
| 8 | Prestanda i achievements.py – SQL-queries i loopar | Kod | ✅ Klar |
| 9 | Claude-priser konfigurerbart via env-variabel (constants.py) | Kod | ✅ Klar |
| 10 | Tillgänglighet (ARIA) i OCR-läget | UX | ✅ Klar |
| 11 | Dra-och-släpp för formulärordning | UX | ✅ Klar |
| 12 | Samla globala variabler i state-objekt i gravplatser.js | Kod | ✅ Klar |
| 13 | Se över tangentbordskommandon – konflikter och täckning (t.ex. modalers effekt på globala genvägar) | UX | ✅ Klar |
| 14 | Klick på färdigtranskriberat kvarter i statistikdiagrammen på startsidan ska navigera till första graven i kvarteret (inte visa felmeddelande/alert) | UX | ✅ Klar |
| 15 | ⌨-knapp (och ?-tangent) i menyraden på /gravplatser visar en dialog med alla kortkommandon. C-tangent för att trigga Claude-hämtning. Fix: Ctrl+S triggar inte längre skiss-knappen. | UX | ✅ Klar |
| 16 | Ersätt webbläsarens alert()/confirm()/prompt() med lämpligare UI-komponenter – se detaljerad inventering nedan | UX | ⬜ |
| 17 | Konsolidera de fyra separata `document.addEventListener('keydown')`-lyssnarna i gravplatser.js till en enda lyssnare med tydlig prioritetsordning för modal-guards – enklare att överblicka och debugga | Kod | ⬜ |

---

## #16 – Inventering av alert()/confirm()/prompt() (41 förekomster)

**Strategi:**
- Bygg ett gemensamt `showToast(meddelande, typ)` i `static/utils.js` och `static/style.css` (typ: `"fel"`, `"ok"`, `"info"`). Toasten visas ~3–5 sek, försvinner automatiskt, och placeras t.ex. längst ned till höger.
- Ersätt felmeddelanden och infomeddlanden med toast.
- Ersätt valideringsmeddelanden med inline-text nära formulärelementet.
- Behåll `confirm()` för destruktiva åtgärder (se lista nedan) — dessa kan uppgraderas till native `<dialog>`-baserade confirm-modaler i ett senare skede.
- `prompt()` i admin.html bör bli inline-formulär i sin tabell-rad, men kan lämnas till sist.

---

### static/gravplatser.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 520 | alert | `'Kunde inte uppdatera: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 706 | alert | `'Kunde inte uppdatera: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 784 | alert | `'Kunde inte uppdatera: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 801 | alert | `'Kunde inte uppdatera: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 979 | alert | `'Rapport: ' + (e.message \|\| 'fel')` | Toast fel |
| 1634 | alert | `'Markera ett område genom att dra på bilden.'` | Inline i skiss-modalen |
| 1663 | alert | `'Kunde inte spara skiss.'` | Inline i skiss-modalen eller Toast fel |
| 2939 | confirm | `'Gravplatsen ingår i ett pågående batch-jobb. Vill du ändå köra en enskild körning nu?'` | **Behåll** (viktig bekräftelse) |
| 2970 | alert | `'Kunde inte hämta data från Claude: ' + (err.message \|\| 'okänt fel')` | Toast fel (eller befintlig banner `gp-ocr-kommentar-banner`) |
| 2993 | confirm | `'Du har osparade ändringar. Sluta redigera utan att spara?'` | **Behåll** (viktig bekräftelse) |

### static/index.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 176 | alert | `'Ingen ej färdig gravplats hittades. Alla gravplatser är markerade som färdigtranskriberade.'` | Toast info |
| 189 | alert | `'Kunde inte hämta nästa gravplats: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 214 | alert | `'Ingen ej färdig gravplats i ' + kyrkogard + '. Alla är färdigtranskriberade.'` | Toast info (OBS: #14 löste detta för kvarter-fallet; kvarstår för kyrkogård-nivå) |
| 227 | alert | `'Kunde inte hämta gravplats: ' + (err.message \|\| 'nätverksfel')` | Toast fel |
| 272 | alert | `'Kunde inte hämta gravplats: ' + (err.message \|\| 'nätverksfel')` | Toast fel |

### static/app.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 739 | alert | `'Kunde inte infoga tom sida: ' + e.message` | Toast fel |
| 754 | alert | `'Kunde inte ta bort infogad sida: ' + e.message` | Toast fel |
| 771 | alert | `'Kunde inte flytta sida: ' + e.message` | Toast fel |
| 789 | alert | `'Kunde inte uppdatera: ' + e.message` | Toast fel |
| 813 | alert | `'Kunde inte infoga: ' + e.message` | Toast fel |
| 837 | alert | `'Kunde inte infoga: ' + e.message` | Toast fel |
| 864 | alert | `'Kunde inte ta bort: ' + e.message` | Toast fel |

### static/gravplatser-ocr.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 607 | alert | `'OCR misslyckades: ' + (err && err.message ? err.message : 'okänt fel')` | Toast fel |

### static/gravplatser-rapport.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 104 | alert | `'Ingen gravplats vald.'` | Inline i rapport-modalen eller disabled-knapp |
| 112 | alert | `'Kunde inte ladda transkriberad information.'` | Toast fel |
| 132 | alert | `'Kunde inte hämta gravplatsbilder: ' + (e.message \|\| 'nätverksfel')` | Toast fel |

### static/gravplatser-sok.js

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 320 | alert | `'Ange minst ett sökvillkor (t.ex. kyrkogård, kvarter, namn eller ett datumintervall) innan du söker.'` | Inline under sökformuläret |

### static/admin.html

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 115 | prompt | `'Nytt lösenord för användaren:'` | Inline-formulär i tabellraden (lägre prio) |
| 124 | alert | `'Lösenord uppdaterat.'` | Toast ok |
| 127 | alert | `'Fel: ' + (e.message \|\| 'nätverksfel')` | Toast fel |
| 135 | prompt | `'Nytt användarnamn:', gammalt` | Inline-formulär i tabellraden (lägre prio) |
| 139 | alert | `'Användarnamn kan inte vara tomt.'` | Inline |
| 151 | alert | `'Användarnamn uppdaterat till: ' + (d.username \|\| trimmed)` | Toast ok |
| 155 | alert | `'Fel: ' + (e.message \|\| 'nätverksfel')` | Toast fel |
| 169 | alert | `'Kunde inte ändra Claude-status.'` | Toast fel |
| 183 | alert | `'Kunde inte ändra Batch-status.'` | Toast fel |
| 191 | confirm | `'Vill du verkligen ta bort användaren "' + username + '"? Detta kan inte ångras.'` | **Behåll** (destruktiv åtgärd) |
| 197 | alert | `'Användaren borttagen.'` | Toast ok |
| 200 | alert | `'Fel: ' + (e.message \|\| 'nätverksfel')` | Toast fel |
| 253 | alert | `'Fel: ' + (e.message \|\| 'nätverksfel')` | Toast fel |

### static/batch-claude.html

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 506 | confirm | `'Stoppa jobbet permanent? Väntande gravplatser hoppas över.'` | **Behåll** (destruktiv åtgärd) |
| 557 | confirm | `'Ta bort jobbet?'` | **Behåll** (destruktiv åtgärd) |
| 629 | alert | `'Kunde inte hämta jobbet.'` | Toast fel |
| 632 | alert | `'Inga körda gravplatser i detta jobb ännu.'` | Toast info |
| 635 | alert | `'Fel: ' + (e.message \|\| 'okänt')` | Toast fel |
| 674 | alert | `'Fel vid körning.'` | Toast fel |
| 696 | alert | `'Nätverksfel: ' + (e.message \|\| '')` | Toast fel |
| 710 | confirm | `'Stoppa jobbet permanent? Väntande gravplatser hoppas över.'` | **Behåll** (destruktiv åtgärd) |

### static/admin-achievement-niva.html

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 353 | alert | `'Kunde inte spara: ' + (e.message \|\| 'nätverksfel')` | Toast fel |
| 409 | alert | `'Kunde inte spara yrkesgrupper: ' + (e.message \|\| 'nätverksfel')` | Toast fel |

### static/grunddata-kyrkogardar.html

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 89 | confirm | `'Ta bort kyrkogården "' + kod + '"?'` | **Behåll** (destruktiv åtgärd) |
| 97 | alert | `'Fel: ' + (e.message \|\| 'nätverksfel')` | Toast fel |

### static/installningar.html

| Rad | Typ | Nuvarande meddelande | Åtgärd |
|-----|-----|----------------------|--------|
| 256 | confirm | `'Ta bort den sparade API-nyckeln?'` | **Behåll** (destruktiv åtgärd) |

### static/databasunderhall-generell-*.html (4 filer)

Alla är valideringsmeddelanden av typen `'Välj minst ett fält.'` eller `'Ange antingen…'` — ersätt med inline-text under formuläret i respektive fil.

| Fil | Rad(er) | Åtgärd |
|-----|---------|--------|
| databasunderhall-generell-endast-siffror.html | 102 | Inline under formulär |
| databasunderhall-generell-siffror-komma.html | 110 | Inline under formulär |
| databasunderhall-generell-tecken.html | 121, 122 | Inline under formulär |
| databasunderhall-generell-mellanslag.html | 102 | Inline under formulär |
| databasunderhall-generell-langd.html | 114, 120 | Inline under formulär |
