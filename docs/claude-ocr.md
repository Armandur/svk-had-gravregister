# Claude OCR – enskild och batch

Applikationen kan använda Claude (Anthropic AI) för att automatiskt transkribera gravplatser från bilderna. Det finns två lägen: **enskild körning** (en gravplats i taget) och **batch-körning** (ett helt urval på en gång).

## Förutsättningar

- En Anthropic API-nyckel måste vara konfigurerad under **Inställningar → API-nycklar**.
- Claude-funktioner måste vara aktiverade för instansen (**Inställningar → Claude OCR → Aktivera Claude-funktioner för hela instansen**).
- Åtkomst kan också styras per användare av en admin.

## Enskild körning

1. Öppna en gravplats och klicka **Redigera gravplatsen**.
2. Klicka **Hämta från Claude** i formulärrubriken.
3. Claude analyserar alla tre bilddelar och returnerar ett förslag på ifyllnad.
4. Förslaget visas i en panel; klicka **Ladda in i formuläret** för att se en diff med de föreslagna ändringarna.
5. Granska, applicera och spara.

> Om gravplatsen ingår i ett pågående batch-jobb kan enskild körning vara blockerad (styrs av inställningen **Blockera enskild Claude-körning för gravar i pågående batch-jobb** under Inställningar). En lila banner visas i redigeringsläge när det finns ett aktivt batch-jobb för gravplatsen.

## Batch Claude OCR

**Batch Claude OCR** (länk på startsidan för admin) låter dig köra OCR på ett stort urval gravplatser och sedan granska resultaten.

### Skapa ett batch-jobb

1. Välj **kyrkogård** och **gravkvarter** (eller välj "Alla kvarter").
2. Ange **Antal** gravplatser att köra (eller lämna tomt för alla i urvalet).
3. Välj om endast **ej påbörjade** gravplatser ska inkluderas.
4. Klicka **Kör batch**.

### Körsätt – realtid vs. Anthropic Batch API

Beroende på urvalet väljs körsätt automatiskt:

| Urval | Körsätt | Kommentar |
|-------|---------|-----------|
| Färre än 100 gravplatser | **Realtid (Messages API)** | Resultat direkt; progress visas i realtid; kan pausas när som helst |
| 100 gravplatser eller fler | **Anthropic Batch API** | 50 % lägre kostnad; asynkront – resultaten kan dröja upp till 24 timmar (vanligtvis 1–2 h); status kontrolleras via knappen i jobblistan |

### Statusar för batch-jobb

- **Kör** – realtidsjobb pågår
- **Väntar på svar** – Anthropic Batch-jobb är skickat och väntar på svar
- **Klar** – alla poster är processade; redo att granska
- **Pausad** – realtidsjobb pausat av användaren
- **Avbruten** – jobbet avbröts

### Granska resultat

När ett jobb är klart klickar du **Granska** i jobblistan. Du bläddrar igenom gravplatserna en och en, ser Claudes förslag och kan applicera, justera eller hoppa över varje post. Spara-knappen och "Färdigtranskriberad"-knappen är tillgängliga efter att du applicerat ett förslag.

### Felhantering

Rader som misslyckades (t.ex. p.g.a. tillfälliga nätverksfel) visas i en fellogg per jobb. Appen försöker automatiskt igen med exponentiell backoff vid hastighetsbegränsning (HTTP 429).

## Anropslogg

Under **Inställningar → Claude OCR → Anropslogg (tokens och kostnad)** kan administratörer se alla Claude-anrop med token-förbrukning och beräknad kostnad i USD och SEK (valutakursen hämtas automatiskt).
