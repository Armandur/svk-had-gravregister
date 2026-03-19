# Administratörsguide

Den här sidan riktar sig till administratörer och systemförvaltare. Vanliga användare behöver inte känna till dessa funktioner.

## Roller

| Roll | Kan göra |
|------|----------|
| **Admin** | Allt nedan plus användarhantering, grunddatakonfiguration, inställningar, loggar och databasunderhåll |
| **Vanlig användare** | Bläddra, söka, mata in och redigera gravplatser enligt tilldelade rättigheter |

Den första användaren som skapas i en ny databas får automatiskt admin-rollen.

## Kom igång – ny installation

1. Sätt miljövariabeln `ADMIN_INITIAL_PASSWORD` innan första start så skapas användaren `admin` med det lösenordet automatiskt.
2. Logga in, gå till **Inställningar → Användarhantering** och skapa konton för transkriberings­personal.
3. Konfigurera kyrkogårdar under **Grunddatahantering → Kyrkogårdar**.
4. Lägg källdata (PDF-mappar) på rätt plats enligt [DOCKER.md](../DOCKER.md) eller README.
5. Aktivera Claude-funktioner om det ska användas (se nedan).

## Användarhantering

Under **Inställningar → Användarhantering** (admin) kan du:

- Skapa, redigera och inaktivera användarkonton.
- Tilldela admin-rollen.
- Styra om en enskild användare ska ha tillgång till **Claude OCR** (enskilda körningar) respektive **Claude Batch OCR** – de styrs av två separata kryssrutor ("Claude" och "Batch") per användare i listan. Båda kräver att Claude är aktiverat för hela instansen (se nedan).

## Grunddatahantering – kyrkogårdar

Under **Grunddatahantering → Kyrkogårdar** konfigurerar du de kyrkogårdar och gravkvarter som ska vara valbara i appen. Dessa styr vilka mappar som kopplas till vilken kyrkogård/kvarter och används i sökningar.

Listan kan också begränsas via miljövariabeln `KYRKOGARDAR` i konfigurationen.

## Claude OCR – inställningar

Claude OCR är en valfri funktion som kräver ett Anthropic-konto och medför kostnad per körning (tokens). Aktivera det bara om det finns budget och behov.

### API-nyckel

Under **Inställningar → API-nycklar** anger du Anthropic API-nyckeln. Den sparas i `api_keys.json` bredvid databasen. Miljövariabeln `ANTHROPIC_API_KEY` har prioritet om den är satt (rekommenderas i produktionsmiljö).

### Aktivera/inaktivera för instansen

Under **Inställningar → Claude OCR** finns en kryssruta **Aktivera Claude-funktioner för hela instansen**. Utan detta syns inte Claude-knapparna för några användare, oavsett om en nyckel är satt.

### Blockera enskild körning vid pågående batch-jobb

Kryssrutan **Blockera enskild Claude-körning för gravar i pågående batch-jobb** förhindrar att en användare skickar ett enskilt anrop för en gravplats som redan bearbetas av ett batch-jobb. Rekommenderas för att undvika dubbla kostnader.

### Claude-modell

Under **Inställningar → Claude OCR** kan du ange vilken Claude-modell som ska användas för OCR-körningar (enskilda och batch). Lämna fältet tomt för att använda standardmodellen `claude-sonnet-4-6`.

Prioritetsordning:
1. Miljövariabeln `CLAUDE_MODEL` (om satt låses fältet i UI:t)
2. Inställningen i admin-UI:t
3. Standardvärde: `claude-sonnet-4-6`

Exempel på modell-ID: `claude-haiku-4-5-20251001` (snabbare/billigare), `claude-opus-4-6` (mer kapabel/dyrare).

### Anropslogg

Under **Inställningar → Claude OCR → Anropslogg** ser du alla Claude-anrop med token-förbrukning och beräknad kostnad i USD och SEK (valutakursen hämtas automatiskt). Filtrera per användare och se totalkostnaden.

### Batch Claude OCR

**Batch Claude OCR** (länk på startsidan, visas bara för admins) låter dig köra OCR på ett stort urval gravplatser och sedan låta transkriberings­personal granska resultaten. Se [Claude OCR – enskild och batch](claude-ocr.md) för fullständig beskrivning av batch-flödet, körsätt och statusar.

## Säkerhetskopior

Under **Inställningar → Säkerhetskopior** kan du ladda ned en kopia av databasen som en SQLite-fil. Filnamnet innehåller datum, tid, branch och commit för spårbarhet. Säkerhetskopiera regelbundet – särskilt innan databasunderhåll eller uppgraderingar.

## Loggar

**Inställningar → Loggar** visar redigeringslogg för gravplatser: vem ändrade vad och när. Används för spårbarhet och granskning av transkriberings­arbetet.

## Databasunderhåll

Under **Inställningar → Databasunderhåll** finns verktyg för att:

- Hitta och åtgärda gravplatser som saknar postnummer/ort.
- Identifiera datakvalitetsproblem (dubbletter, ogiltiga datum, felaktiga tecken m.m.).
- Granska enskilda användares registreringar i kronologisk ordning.

Använd verktygen enligt instruktionerna i gränssnittet. Gör alltid en säkerhetskopia innan du kör underhållsåtgärder.

## Prestationsadministration

Under **Inställningar → Prestationsadministration** finns tre sektioner:

### Prestationsgränser

Tabellerna visar alla prestationskategorier uppdelade i **Registreringar & övrigt** och **Yrkes-prestationer**. För varje rad kan du:

- Ändra **gränsvärdet** (minsta antal för respektive medal­j­nivå – brons, silver, guld).
- Ändra **etiketten** – en kort text som visas i presationsgränssnittet, t.ex. "500 st".
- Klicka **▶ Testa** för att förhandsgranska hur toast-meddelandet kommer se ut för den nivån.

Tryck **Spara gränsvärden** när du är klar. Ändringarna gäller direkt för alla användare.

### Yrkesgrupper

Varje yrkesbaserad prestation (t.ex. "Kyrkans man" eller "Havets män") har ett eget expanderbart kort som visar vilka yrkestitlar som räknas in. Expandera ett kort för att lägga till, redigera eller ta bort yrken, och tryck sedan **Spara gruppen** (sparas separat per grupp).

### Toast-texter

Styr vilka meddelanden som dyker upp i det lilla popup-fönstret (toasten) när en användare:

- Uppnår en ny achievement-nivå (brons/silver/guld)
- Registrerar ett yrke som inte setts förut
- Är nära att nå nästa nivå (80–99 % av tröskeln)

Varje typ har en lista med varianter – systemet väljer slumpmässigt bland dem varje gång. Du kan:

- Redigera befintliga texter direkt i textfälten.
- Lägga till nya varianter med **+ Ny variant**.
- Ta bort varianter med **✕**-knappen.
- Förhandsgranska enskilda texter med **▶**-knappen bredvid varje textfält.

**Tillgängliga platshållare per typ:**

| Typ | Platshållare |
|-----|-------------|
| Achievement | `{emoji}` `{niva}` `{label}` `{antal}` |
| Nytt yrke | `{yrke}` |
| Nästan framme | `{label}` `{kvar}` `{nasta}` |

Tryck **Spara** för respektive typ när du är klar.
