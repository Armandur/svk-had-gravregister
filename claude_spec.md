


Självklart! Här är den uppdaterade specifikationen. Jag har vävt in våra nya regler för **"Storlek" kontra skiss-innehåll**, adderat objektet för **`skiss_koordinater`**, samt förtydligat hur modellen ska undvika att förväxla **dag** med **föd. nr/db. nr**.

Detta dokument kan du kopiera rakt av och använda som systemprompt för framtida instanser av mig eller andra AI-modeller i ditt flöde.

---

# Specifikation: OCR-extraktion till gravregister-databas (Uppdaterad)

Denna specifikation beskriver hur data i ett gravregister ska struktureras och vilka format som gäller, så att en AI-modell kan extrahera all information korrekt från skannade bilder (OCR) och leverera data som passar systemets databas och API. Extraktionen inkluderar även visuell analys för att identifiera och returnera bildkoordinater för specifika sektioner (t.ex. skisser).

---

## 1. Översikt

Gravregistret hanterar **gravplatser** med tillhörande:
- **Gravrättsinnehavare** (en eller flera)
- **Närmast anhöriga** (noll eller flera)
- **Gravsatta** (position 1–10; varje position är antingen en person eller en beteckning t.ex. "Per Augusts familjegrav")
- **Inmatningsdata** för gravplatsen (underhåll, gravrättstid, monument, utfärdat datum, skiss-koordinater, kommentar m.m.)

All text som syns på bilderna ska extraheras och mappas till rätt fält enligt nedan. **Datum** kan vara ofullständiga och måste representeras exakt enligt de format som beskrivs i avsnitt 3.

---

## 2. Datastruktur (fält som ska extraheras)

### 2.1 Gravrättsinnehavare (per gravplats, lista)

| Fält (API/DB) | Typ | Beskrivning |
|---------------|-----|-------------|
| `fornamn` | sträng | Förnamn |
| `efternamn` | sträng | Efternamn |
| `yrke` | sträng | Yrke/titel (t.ex. "Kyrkoherde", "Handlaren") |
| `gatuadress` | sträng | Gatuadress |
| `postnummer` | sträng | Postnummer |
| `postort` | sträng | Postort |
| `kommentar` | sträng | Övrig kommentar |

*Tomma strängar om fältet inte finns på bilden.*

---

### 2.2 Närmast anhöriga (per gravplats, lista)

| Fält (API/DB) | Typ | Beskrivning |
|---------------|-----|-------------|
| `fornamn` | sträng | Förnamn |
| `efternamn` | sträng | Efternamn |
| `yrke` | sträng | Yrke/titel |
| `adress` | sträng | Gatuadress |
| `postnummer` | sträng | Postnummer |
| `postort` | sträng | Postort |
| `telefon` | sträng | Telefonnummer |
| `kommentar` | sträng | Övrig kommentar |

---

### 2.3 Gravplatsinmatning (en rad per gravplats)

| Fält (API/DB) | Typ | Beskrivning |
|---------------|-----|-------------|
| `storlek` | sträng | Storlek (t.ex. "3 kvm"). **OBS!** Hämtas endast från fältet markerat "Storlek". Markeringar inuti skiss-rutorna ska ignoreras. |
| `skiss_koordinater`| objekt | Koordinater `{ "x_min": int, "y_min": int, "x_max": int, "y_max": int }` för skiss-sektionen på bilden. Null om skiss saknas. |
| `underhall_text` | sträng | Underhållstext (t.ex. "Underhåll inbetalt för all framtid den …") |
| `underhall_overstruket` | bool | True om "för all framtid" är överstruket |
| `gravrattstid` | sträng | Gravrättstid (fritext) |
| `monument` | sträng | Monument |
| `gravens_utformning` | sträng | Gravens utformning |
| `gravplats_nr` | sträng | Gravplatsnummer (ofta nere i vänstra hörnet, t.ex. "24 Ser XXII"). **Om ett nummer är överstruket och ersatt med ett nytt, används det senast gällande (handskrivna) numret.** Det gamla numret noteras i `kommentar`, t.ex. `"Tidigare gravplats_nr: 24 Ser XXII"`. |
| `karta_nr` | sträng | Karta nr |
| `gravbrev_nr` | sträng | Gravbrev nr |
| `utfardat_den` | sträng | **Datum då gravbrev/utfärdande skedde – se avsnitt 3 (datum)** |
| `kommentar` | sträng | Övrig kommentar |

---

### 2.4 Gravsatta (position 1–10, ordning viktig)

Varje position är antingen en **person** eller en **beteckning** (sätt `ar_beteckning: true` och lagra hela beteckningstexten i fältet `efternamn`; `fornamn` lämnas tomt).

| Fält (API/DB) | Typ | Beskrivning |
|---------------|-----|-------------|
| `position` | heltal | 1–10 (ordning på sidan) |
| `ar_beteckning` | bool | True om raden är en beteckning (t.ex. familjegrav), inte en persons namn |
| `fornamn` | sträng | Förnamn. **Lämnas tomt (`""`) när `ar_beteckning` är true.** |
| `efternamn` | sträng | Efternamn. **När `ar_beteckning` är true lagras hela beteckningstexten här** (t.ex. `"Molin Carl Familjegrav"`). **Om ett flicknamn anges (t.ex. "f. Winqvist") inkluderas det i detta fält** tillsammans med det gifta efternamnet, t.ex. `"Andersson f. Winqvist"`. |
| `yrke` | sträng | Yrke/titel |
| `gatuadress` | sträng | Gatuadress |
| `postnummer` | sträng | Postnummer |
| `postort` | sträng | Postort |
| `fodelse_ar` | heltal/null | Födelseår (1000–9999) |
| `fodelse_manad` | heltal/null | Födelsemånad (1–12), null om endast år är känt |
| `fodelse_dag` | heltal/null | Födelsedag (1–31), null om okänd |
| `fod_nr` | sträng | Födelsenummer. **OBS:** Extrahera endast text från den specifika kolumnen "föd. nr". Undvik att ta dagar från intilliggande kolumn. |
| `dods_ar` | heltal/null | Dödsår |
| `dods_manad` | heltal/null | Dödsmånad (1–12) |
| `dods_dag` | heltal/null | Dödsdag (1–31) |
| `dodsbok_nr` | sträng | Dödsboksnummer. **OBS:** Endast från kolumnen "db. nr". Undvik att ta dagar från intilliggande kolumn. |
| `gravsatt_den` | sträng | **Datum för gravsättning – se avsnitt 3** |
| `urna` | sträng | "urna" \| "kista" \| "okant" \| "" |
| `kommentar` | sträng | Övrig kommentar |

---

## 3. Datum – format och lagring

Systemet stödjer **ofullständiga datum** på tre sätt:
- **Endast år:** ÅÅÅÅ (4 siffror)
- **År och månad:** ÅÅÅÅ-MM
- **Fullständigt datum:** ÅÅÅÅ-MM-DD

### 3.1 Födelse- och dödsdatum (gravsatta)
Dessa lagras som **tre separata heltal** (`år`, `månad`, `dag`). Exempelvis `1842-03` blir `_ar: 1842`, `_manad: 3`, `_dag: null`.

### 3.2 Gravsatt den och Utfärdat den (strängfält)
Dessa fält lagras som **en enda sträng** (`"YYYY"`, `"YYYY-MM"`, eller `"YYYY-MM-DD"`). Exempel på normalisering:
- `"12/7 1909"` → `"1909-07-12"`
- `"620908"` (ÅÅMMDD) → `"1962-09-08"` (århundrade tolkas utifrån kontext)

---

## 4. Övriga regler för extraktion

- **Tomma fält:** Om information saknas på bilden, använd tom sträng `""` eller `null` beroende på fälttyp.
- **Skiss-sektionen:** Markeringar (skrivmaskinstecken som `1 * 2 *`) som är placerade *inuti* de rektangulära skiss-rutorna ska **ignoreras** i text-extraktionen (t.ex. fältet `storlek`). Istället ska bounding box-koordinater för hela skiss-området anges i `skiss_koordinater`. Mått och yta placerade i rutan "Storlek" ovanför ska dock plockas ut.
- **Skrivfel i källan:** Extrahera exakt vad som står. Normalisering görs endast på datum och årtal (ex. om födelseår anges som "90" i stället för "1890" och det av kontexten är tydligt vilket århundrade som avses).
- **Kolumner för nr:** Var extremt noggrann med att skilja på kolumnen för "dag" och kolumnen för "föd. nr" / "db. nr". Siffror i dag-kolumnen får aldrig hamna i nummer-fälten.
- **Urna/kista:** Om texten i anslutning till namnet anger "(urna)", sätt `urna` till `"urna"`.
- **Gravsatta i icke-sekventiell ordning:** Om kortets numrerade positioner inte är ifyllda i följd (t.ex. 1–3 ifyllda, 4–5 tomma, 6–7 ifyllda) tilldelas de faktiskt ifyllda positionerna löpande position 1, 2, 3, 4… i utdatan. Det ursprungliga numret på kortet noteras i `kommentar`, t.ex. `"Inför på gravplats nr 6"`.
- **Flicknamn (f. / född):** Om en persons ogifta namn anges på kortet (t.ex. "Andersson Maja Kristina f. Winqvist") lagras det gifta efternamnet och flicknamnet **tillsammans i `efternamn`**: `"Andersson f. Winqvist"`. Förnamnen lagras som vanligt i `fornamn`: `"Maja Kristina"`.

---

## 5. Exempel på utdata (JSON-liknande)

```json
{
  "innehavare":[
    {
      "fornamn": "Per",
      "efternamn": "Vinqvist",
      "yrke": "Hospitalsöfverläkaren",
      "gatuadress": "",
      "postnummer": "",
      "postort": "",
      "kommentar": ""
    }
  ],
  "narmast_anhoriga":[],
  "storlek": "3 kvm",
  "skiss_koordinater": {
    "x_min": 40,
    "y_min": 312,
    "x_max": 1140,
    "y_max": 484
  },
  "underhall_text": "24/5 1935 med kronor 500:- Vård nr 204",
  "underhall_overstruket": false,
  "gravrattstid": "Ev tid kr 100:- erlagd den 6/12 1910",
  "monument": "",
  "gravens_utformning": "",
  "gravplats_nr": "20 Ser XXII",
  "karta_nr": "",
  "gravbrev_nr": "",
  "utfardat_den": "1910-12-06",
  "kommentar": "",
  "gravsatta":[
    {
      "position": 1,
      "ar_beteckning": false,
      "fornamn": "Gerda Maria",
      "efternamn": "Winqvist",
      "yrke": "",
      "gatuadress": "",
      "postnummer": "",
      "postort": "Uppsala",
      "fodelse_ar": 1890,
      "fodelse_manad": 7,
      "fodelse_dag": 2,
      "fod_nr": "1406",
      "dods_ar": 1980,
      "dods_manad": 3,
      "dods_dag": 21,
      "dodsbok_nr": "118",
      "gravsatt_den": "1980-06-27",
      "urna": "urna",
      "kommentar": ""
    }
  ]
}
```

---

## 6. Checklista för validering av OCR-utdata

- [ ] `skiss_koordinater` är angivna som ett rektangelobjekt om skisser finns, markeringar inuti skisserna ("1 * 2 *") har inte spillt över till "storlek"-fältet.
- [ ] Dagar och månader ligger i korrekta variabler (`_manad`, `_dag`) och har *inte* råkat hamna i `fod_nr` eller `dodsbok_nr` bara för att de står nära kanten.
- [ ] Alla datum som endast har år är `YYYY` (sträng) eller ar/manad/dag med manad/dag = `null`.
- [ ] Gravsatta har position 1–10 i ordning; tomma positioner behöver inte skickas.
- [ ] Inga obligatoriska fält (enligt API) saknas; tomma strängar `""` eller `null` används konsekvent.
- [ ] När `ar_beteckning` är true: `efternamn` innehåller hela beteckningstexten och `fornamn` är `""`.