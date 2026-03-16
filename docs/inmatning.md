# Inmatning och transkribering

## Formulär per gravplats

För varje gravplats fyller du i fyra typer av uppgifter:

### Gravplats (själva platsen)

Uppgifter som hör till **gravplatsen**, inte till innehavaren: storlek, skiss (bild), underhåll, gravrättstid, monument, gravens utformning, samt längst ned: gravplats nr, karta nr, gravbrev nr, utfärdat den.

### Gravrättsinnehavare

**Personen/personerna** som har gravrätten: namn/benämning, yrke, adress (gatuadress, postnummer, postort). Det kan finnas flera innehavare per gravplats.

### Närmast anhörig

**Eget block** – t.ex. kontaktperson eller närmaste anhörig (inte samma som gravrättsinnehavare): namn, adress, eventuellt telefon och yrke. Det kan finnas flera poster per gravplats.

### Gravsatta 1–5 och 6–10

Namn, adress, födelse (år, månad, dag, föd.nr), död (år, månad, dag, dödsbok nr), gravsatt den, urna.

Endast de fält som ofta förekommer i källmaterialet är obligatoriska; övriga kan lämnas tomma.

## Claude OCR – automatisk transkribering

När du är i redigeringsläge visas knappen **Hämta från Claude** i formulärrubriken. Klicka på den för att skicka alla tre bilddelar för den aktuella gravplatsen till Claude (AI), som analyserar bilderna och föreslår ifyllnad av alla fält. Resultatet visas i en panel under knappen; klicka **Ladda in i formuläret** för att se en diff med föreslagna ändringar och sedan applicera dem. Du kan alltid kontrollera och justera värdena innan du sparar.

> **OBS:** Claude-funktioner kräver att en Anthropic API-nyckel är konfigurerad och att Claude-åtkomst är aktiverad för instansen (görs under **Inställningar**). Om gravplatsen ingår i ett pågående batch-jobb kan enskild körning vara blockerad (inställning under **Inställningar → Claude OCR**).

Se även [Claude OCR – enskild och batch](claude-ocr.md) för detaljer om batch-körning.

## OCR-hjälp (fältmarkering)

Du kan också markera ett område direkt på den visade PDF-delen så fylls motsvarande fält i. Du kan välja "Efternamn först" / "Förnamn först" och "f. (född)" (namn som ogift) för namn, samt "Adress" för att fylla gatuadress, postnummer och postort från en adressrad.

## Kommentarer

Använd kommentarsfältet för handskrivna tillägg, osäkerheter eller undantag (t.ex. "gravsatt 3 enl. övre del 13.pdf, handskriven numrering"). Kommentar kan anges per gravplats, per gravrättsinnehavare, per närmast anhörig och per gravsatt.

## Specialfall

- **Gravbeteckning (beteckning istället för person):** Vilken gravsatt position (1–10) som helst kan användas för en beteckning (t.ex. "Per Augusts familjegrav") i stället för en person. Kryssa i "Gravsatt använd som beteckning" för den aktuella raden; då används fältet för beteckningstext (efternamnslabeln blir "Beteckning").
- **Gravplatsnummer med intervall:** Gravplatsnummer kan anges som t.ex. 1-2, 1+2, 7+8 i källan; samma tre-sidorsstruktur gäller.
- **Överstrukna och handskrivna positionsnummer:** Om tryckta siffror är överstrukna och ersatta med handskrivna, mata in enligt den ordning som avses och använd gärna kommentaren för att förtydliga källan.
