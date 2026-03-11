# Specifikation – Allmän modell (gravregister)

Denna del beskriver **begrepp och fält** som kan gälla för digitalisering av gravregister i allmänhet, oberoende av ett specifikt arkivformat. Applikationen Gravregister är byggd kring denna modell. Konkreta arkivformat (sidlayout, kyrkogårdsbeteckningar, specialfall) beskrivs i egna specifikationer (t.ex. Härnösands domkyrkoförsamling / Skandix).

---

## 1. Begrepp

- **Gravplats:** Enheten som identifieras med **kyrkogård**, **kvarter** och **gravplatsnummer**. En gravplats har uppgifter som **hör till själva platsen** (storlek, skiss, underhåll, monument, gravens utformning, gravplats nr, karta nr, gravbrev nr, utfärdat den) samt kopplade **personer**: gravrättsinnehavare, närmast anhörig och gravsatta.
- **Gravrättsinnehavare:** Den eller de **personer** som har gravrätten. Har egna fält: namn/benämning, yrke, adress, kommentar. Kan vara flera per gravplats.
- **Närmast anhörig:** Ett **eget block** – t.ex. kontaktperson eller närmaste anhörig – med egna fält (namn, adress, telefon, kommentar). Är inte samma sak som gravrättsinnehavare. Kan vara flera per gravplats.
- **Gravsatta:** Personer (eller beteckningar) som är gravsatta på platsen. Varje gravplats kan ha ett antal positioner (t.ex. 1–10); varje position är antingen en person med namn, födelse, död m.m. eller en **beteckning** (t.ex. "Per Augusts familjegrav").
- **Skiss på gravplatsen:** En bild som visar hur gravplatsen är utformad/placerad – hör till **gravplatsen**, inte till innehavaren. Lagras som bild i databasen.
- **Extramaterial:** Källfiler/sidor som inte följer den vanliga sidstrukturen för en gravplats; kan kopplas till en specifik gravplats eller endast till mappen/volymen. Har valfri typ-beteckning (t.ex. lapp, brev, karta).

---

## 2. Fält – Gravplats (själva platsen)

Följande uppgifter **hör till gravplatsen** (inte till innehavaren):

- **Storlek**
- **En skiss på gravplatsen** *(lagras som bild)*
- **Underhåll inbetalt** (datum, ev. om det gäller viss tid eller "all framtid")
- **Gravrättstid**
- **Monument**
- **Gravens utformning**
- **Bottenkant:** **Gravplats nr**, **Karta nr**, **Gravbrev nr**, **Utfärdat den**

**Kommentar** kan anges per gravplats (för handskrivna tillägg, osäkerheter, undantag).

---

## 3. Fält – Gravrättsinnehavare

Uppgifter om **personen/personerna** som har gravrätten:

- Gravrättsinnehavare (namn/benämning)
- Yrke
- Adress – kan lagras och visas som **Gatuadress**, **Postnummer**, **Postort**

**Kommentar** kan anges per gravrättsinnehavare. Det kan finnas flera innehavare per gravplats.

---

## 4. Fält – Närmast anhörig

**Eget block**, skilt från gravrättsinnehavare (t.ex. kontaktperson / närmaste anhörig):

- Namn (förnamn, efternamn)
- Yrke *(kan förekomma i vissa arkiv)*
- Adress – Gatuadress, Postnummer, Postort
- Telefon *(kan förekomma)*

**Kommentar** kan anges per närmast anhörig. Det kan finnas flera poster per gravplats.

---

## 5. Fält – Gravsatta

För varje gravsatt position (person eller beteckning):

- **Namn** – kan anges som förnamn och efternamn; ev. **namn som ogift** (förkortat f. född) som tillägg till efternamnet
- **Adress** – Gatuadress, Postnummer, Postort
- **Yrke** *(kan förekomma i vissa arkiv)*
- **Födelse** – år, månad, dag; födelsenummer (föd.nr)
- **Död** – år, månad, dag; dödsbok nr (db. nr)
- **Gravsatt den**
- **Urna** *(kan anges i vissa fall)*

**Beteckning:** Vilken position som helst kan användas som **beteckning** (t.ex. "Per Augusts familjegrav") i stället för en person; då används ett fält för beteckningstext.

**Kommentar** kan anges per gravsatt. Endast de fält som ofta förekommer i källmaterialet behöver vara obligatoriska; övriga kan vara tomma.

---

## 6. Lagring och export

- **Primär lagring:** Databas. Gravplatser (kyrkogård, kvarter, gravplatsnummer) med uppgifter om **gravplatsen** (storlek, skiss, underhåll, monument m.m.), **gravrättsinnehavare**, **närmast anhörig**, **gravsatta**, samt extramaterial (kopplat till gravplats eller mapp, valfri typ).
- **Adress:** Lagras som Gatuadress, Postnummer, Postort där det stöds.
- **Kommentarer:** Per gravplats, per gravrättsinnehavare, per närmast anhörig, per gravsatt.
- **Export/import:** T.ex. JSON (och vid behov andra format).
- **Spårbarhet till källa:** Gravplatsen är kopplad till de källfiler/sidor som utgör dess innehåll, så att digitaliseringen kan granskas och verifieras.

---

## 7. Användargränssnitt (allmänt)

- **Visning av källmaterial:** Källorna (t.ex. PDF-sidor) visas så att användaren kan läsa och transkribera. Beskärning och antal sidor per gravplats styrs av arkivformatet.
- **Bläddring:** Användaren kan gå mellan gravplatser; hur många sidor som flyttas per steg beror på arkivformatet.
- **Inmatning:** Formulär för **gravplats** (storlek, skiss, underhåll, monument osv.), **gravrättsinnehavare**, **närmast anhörig** och **gravsatta**; sparas i databasen.
- **Länk till källa:** Varje visad del ska kunna kopplas till motsvarande källfil/sida.
- **OCR-hjälp:** Vid behov kan text extraheras från bilder (t.ex. namn, adress) för att fylla fält.
- **Extramaterial:** Sidor som inte följer normalstrukturen kan plockas ur och kopplas till gravplats eller mapp med valfri typ.

---

*Allmän modell för Gravregister. Konkreta arkivformat beskrivs i egna specifikationer.*
