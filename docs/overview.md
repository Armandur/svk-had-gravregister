# Översikt

Gravregister är en webbapplikation för att digitalisera skannade gravregister (HKG/HKN). Du arbetar med PDF-filer som ligger i **källdata** (en mapp per arkiv) och matar in uppgifter i databasen: **gravplatsen** (storlek, skiss, underhåll, monument m.m.), **gravrättsinnehavare**, **närmast anhörig** och **gravsatta**.

## Huvudfunktioner

- **Bläddring:** Välj mapp (kyrkogård/gravkvarter), ange försättssidor om det behövs, och bläddra mellan gravplatser. Varje gravplats visas som tre delar (gravrättsinnehavare, gravsatta 1–5, gravsatta 6–10).
- **Inmatning:** Fyll i formulär för gravplats (storlek, skiss, underhåll, monument osv.), gravrättsinnehavare, närmast anhörig och gravsatta; data sparas i databasen och kan exporteras.
- **Claude OCR:** Automatisk transkribering med AI – antingen för en enskild gravplats (knappen **Hämta från Claude** i redigeringsläge) eller i bulk via **Batch Claude OCR** (kör och granska ett helt gravkvarter automatiskt).
- **Extramaterial:** PDF-sidor som inte följer den vanliga tre-sidorsstrukturen kan plockas ur och kopplas till en gravplats eller endast till mappen.
- **Sökning:** Sök gravplatser på fullständigt nummer eller via avancerad sökning (kyrkogård, kvarter, namn m.m.).
- **Grunddata:** Hantera kyrkogårdar och användare (admin).
- **Prestationer:** Varje användare kan följa sin transkriberings­statistik och låsa upp utmärkelser (brons/silver/guld) baserat på antal registreringar och unika yrken. Inställningar för roliga saker (toast och ljud) och ordning på inmatnings­sektioner finns under **Prestationer** (länk i sidhuvudet).
- **Inställningar:** Administrera API-nycklar (Anthropic), aktivera/inaktivera Claude-funktioner per instans, hantera säkerhetskopior och se anropslogs med token­kostnad.

## Kom igång

1. Logga in på startsidan.
2. Välj **Bläddra via kyrkogård, kvarter och gravplats** eller **Avancerad sökning** för att hitta en gravplats.
3. På en gravplats kan du bläddra i käll-PDF:erna och fylla i inmatningsformuläret.
4. Använd **Hjälp** (denna sida) för att läsa mer om de olika funktionerna.
