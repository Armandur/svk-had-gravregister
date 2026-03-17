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

## OCR-hjälp (fältmarkering)

Du kan markera ett område direkt på den visade PDF-delen så fylls motsvarande fält i. Textextrahering sker med **Tesseract.js** (version 4, svenska + engelska) som laddas och körs direkt i din webbläsare – ingen data skickas till någon extern tjänst och det krävs ingen API-nyckel.

Du kan välja "Efternamn först" / "Förnamn först" och "f. (född)" (namn som ogift) för namn, samt "Adress" för att fylla gatuadress, postnummer och postort från en adressrad.

> **Tips:** Eftersom Tesseract är en generell OCR-motor (till skillnad från Claude som förstår dokumentets struktur) kan extraherad text ibland behöva rättas. Läs alltid igenom förslaget och korrigera stavning, siffror och bindestreck innan du sparar – var extra noggrann med namn, datum och adresser.

## Claude OCR – automatisk transkribering (valfritt)

Om Claude-åtkomst är aktiverad av administratören visas knappen **Hämta från Claude** i formulärrubriken när du är i redigeringsläge. Klicka på den för att skicka alla tre bilddelar till Claude (AI), som analyserar bilderna och föreslår ifyllnad av alla fält. Resultatet visas i en panel; klicka **Ladda in i formuläret** för att se en diff med föreslagna ändringar och sedan applicera dem. Du kan alltid kontrollera och justera värdena innan du sparar.

> Om gravplatsen ingår i ett pågående batch-jobb kan enskild körning vara blockerad – en lila banner visas i så fall i redigeringsläge.

Se [Claude OCR – enskild och batch](claude-ocr.md) för mer information. Admins hittar inställningar i [administratörsdokumentationen](admin.md).

## Osparade ändringar

Om du försöker navigera till en annan gravplats (med `←`/`→`, knapparna eller kvarterbyte) eller stänga redigeringsläget medan du har osparade ändringar visas en gul bekräftelsepanel direkt i formulärhuvudet:

- **Avbryt ändå** – förkastar ändringarna och utför navigeringen/avslutar redigeringsläget.
- **Fortsätt redigera** – stänger panelen och du är kvar i redigeringsläget med dina ändringar intakta.

## Kommentarer

Använd kommentarsfältet för handskrivna tillägg, osäkerheter eller undantag (t.ex. "gravsatt 3 enl. övre del 13.pdf, handskriven numrering"). Kommentar kan anges per gravplats, per gravrättsinnehavare, per närmast anhörig och per gravsatt.

## Specialfall

- **Gravbeteckning (beteckning istället för person):** Vilken gravsatt position (1–10) som helst kan användas för en beteckning (t.ex. "Per Augusts familjegrav") i stället för en person. Kryssa i "Gravsatt använd som beteckning" för den aktuella raden; då används fältet för beteckningstext (efternamnslabeln blir "Beteckning").
- **Gravplatsnummer med intervall:** Gravplatsnummer kan anges som t.ex. 1-2, 1+2, 7+8 i källan; samma tre-sidorsstruktur gäller.
- **Överstrukna och handskrivna positionsnummer:** Om tryckta siffror är överstrukna och ersatta med handskrivna, mata in enligt den ordning som avses och använd gärna kommentaren för att förtydliga källan.
