# Översikt

Gravregister är en webbapplikation för att digitalisera skannade gravregister (HKG/HKN). Du arbetar med PDF-filer som ligger i **källdata** (en mapp per arkiv) och matar in uppgifter i databasen: **gravplatsen** (storlek, skiss, underhåll, monument m.m.), **gravrättsinnehavare**, **närmast anhörig** och **gravsatta**.

## Roller

Det finns två roller i systemet:

- **Vanlig användare** – bläddrar i källmaterial och transkriberar gravplatser.
- **Administratör** – konfigurerar systemet (kyrkogårdar, användarkonton, Claude-inställningar m.m.) och ger sedan användare tillgång. Se [Administratörsguide](admin.md).

Administratören bestämmer t.ex. om Claude OCR ska vara tillgängligt och för vilka användare.

## Huvudfunktioner (alla användare)

- **Bläddring:** Välj mapp (kyrkogård/gravkvarter), ange försättssidor om det behövs, och bläddra mellan gravplatser. Varje gravplats visas som tre delar (gravrättsinnehavare, gravsatta 1–5, gravsatta 6–10).
- **Inmatning:** Fyll i formulär för gravplats (storlek, skiss, underhåll, monument osv.), gravrättsinnehavare, närmast anhörig och gravsatta; data sparas i databasen. Som stöd finns **OCR-fältmarkering**: markera ett område direkt på bilden så fylls det valda fältet i med hjälp av Tesseract (körs i webbläsaren, ingen extern tjänst).
- **Claude OCR (valfritt):** Kräver Anthropic API-nyckel och medför token-kostnad per körning. Erbjuder automatisk transkribering med AI – antingen för en enskild gravplats (knappen **Hämta från Claude** i redigeringsläge) eller i bulk via **Batch Claude OCR**. Aktiveras och styrs av administratören.
- **Extramaterial:** PDF-sidor som inte följer den vanliga tre-sidorsstrukturen kan plockas ur och kopplas till en gravplats eller endast till mappen.
- **Sökning:** Sök gravplatser på fullständigt nummer eller via avancerad sökning (kyrkogård, kvarter, namn m.m.).
- **Prestationer:** Följ din egen transkriberings­statistik och lås upp utmärkelser. Anpassa ordningen på inmatnings­sektioner och inställningar för ljud/toast under **Prestationer** (länk i sidhuvudet).

## Kom igång (vanlig användare)

1. Logga in på startsidan.
2. Välj **Bläddra via kyrkogård, kvarter och gravplats** eller **Avancerad sökning** för att hitta en gravplats.
3. På en gravplats kan du bläddra i käll-PDF:erna och fylla i inmatningsformuläret.
4. Använd **Hjälp** (denna sida) för att läsa mer om de olika funktionerna.

> Är du administratör? Se [Administratörsguide](admin.md) för konfiguration, Claude-inställningar, säkerhetskopior och mer.
