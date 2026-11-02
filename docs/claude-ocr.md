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

## Lokal modell

En administratör kan låta gravkorten läsas av en modell på en egen server (ollama) i stället för Claude. Det kostar ingenting men ger något fler fel, främst i namn och nummer. Granska därför varje förslag.

- Under **Inställningar** anger administratören serverns adress och modell. **Testa anslutning** visar om servern svarar och har modellen.
- Under **Inställningar → Användare** slår administratören på kolumnen **Lokal** för de konton som ska få använda den.
- I redigeringsläget finns då knappen **Hämta från lokal modell**. Svaret sparas bredvid ett eventuellt Claude-svar, och panelen listar alla sparade svar. Klicka **Ladda in i formuläret** på det svar du vill utgå från.

## Batch AI

**Batch AI** (länk på startsidan) låter dig köra OCR på ett stort urval gravplatser och sedan granska resultaten. Har kontot både Claude och lokal modell väljer du modell överst i formuläret.

### Skapa ett batch-jobb

1. Välj **kyrkogård** och **gravkvarter** (eller välj "Alla kvarter").
2. Ange **Antal** gravplatser att köra (eller lämna tomt för alla i urvalet).
3. Välj om endast **ej påbörjade** gravplatser ska inkluderas.
4. En **kostnadsuppskattning** visas automatiskt och uppdateras när du ändrar urval eller filter. Uppskattningen visar beräknad kostnad uppdelad per kvartertyp (Allm-kvarter resp. övriga) samt en rekommenderad kreditbuffert med 20 % marginal. Priset justeras automatiskt beroende på om realtid- eller Batch API används.
5. Klicka **Skapa och kör** (realtid) eller **Skapa och skicka till Anthropic** (Batch API).

### Körsätt – realtid vs. Anthropic Batch API

Beroende på urvalet väljs körsätt automatiskt:

| Urval | Körsätt | Kommentar |
|-------|---------|-----------|
| Färre än 100 gravplatser | **Realtid (Messages API)** | Resultat direkt; progress visas i realtid; kan pausas när som helst |
| 100 gravplatser eller fler | **Anthropic Batch API** | 50 % lägre kostnad; asynkront – resultaten kan dröja upp till 24 timmar (vanligtvis 1–2 h); status kontrolleras via knappen i jobblistan |
| Lokal modell, valfritt antal | **Körs på servern** | Gratis; 10–30 sekunder per grav; du kan stänga sidan. Klicka **Följ** i jobblistan för att se förloppet igen. Är modellservern upptagen eller avstängd väntar jobbet och försöker igen |

### Statusar för batch-jobb

- **Kör** – jobbet pågår (realtid i webbläsaren, eller lokal modell på servern)
- **Väntar på svar** – Anthropic Batch-jobb är skickat och väntar på svar
- **Klar** – alla poster är processade; redo att granska
- **Pausad** – jobbet är pausat av användaren. Ett realtidsjobb pausas också om servern startas om, eftersom ingen flik driver det längre
- **Avbruten** – jobbet avbröts

### Granska resultat

När ett jobb är klart klickar du **Granska** i jobblistan. Du bläddrar igenom gravplatserna en och en, ser Claudes förslag och kan applicera, justera eller hoppa över varje post. Spara-knappen och "Färdigtranskriberad"-knappen är tillgängliga efter att du applicerat ett förslag.

### Felhantering

Rader som misslyckades (t.ex. p.g.a. tillfälliga nätverksfel) visas i en fellogg per jobb. Appen försöker automatiskt igen med exponentiell backoff vid hastighetsbegränsning (HTTP 429).

## Anropslogg

Under **Inställningar → Claude OCR → AI-anropslogg** kan administratörer se alla anrop, både till Claude och till lokal modell. Varje rad visar modell, tokens, svarstid och kostnad i USD och SEK (valutakursen hämtas automatiskt). Tabellen **Per modell** visar snittid och snittokens per modell, så modellerna går att jämföra.
