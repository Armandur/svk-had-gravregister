# Backlog Export

## [P3][done] [gravregister] Gravvyn vid mobilbredd: högerspalten klipps i vänsterkanten

Vid 390 px ligger gravvyn kvar i två spalter. Högerspalten (statusknapp, banners, formulär) klipps i vänsterkanten och rubriken överlappar 'Senast redigerad'. Fanns före lokal OCR-arbetet, sett 2026-11-02 i shot av HKG U 25.

- ID: `01M6F0JAR9CR02J4CQT5EFHJ6J`
- Type: bug
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Datakvalitet: 11 granskade gravar bryter mot rimlighetsreglerna

Mätning 2026-11-02 på prod-kopian: gravplats 120, 387, 420 (död före födsel), 223, 404 (över 110 år), 536, 2235 (ogiltigt dödsdatum), 3884, 485, 3980, 3997 (gravsatt före död). Antingen fel på korten eller vid granskning. Visa dem på datakvalitetssidan med samma regler som OCR-varningarna.

- ID: `01M6EXGZNBDX9QNDFEYBKF7ZEZ`
- Type: task
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Godkänna en rimlighetsvarning som korrekt (kortet har faktiskt felet) med kommentar

Rasmus 2026-11-02: om kortet verkligen har ett orimligt värde ska granskaren kunna kvittera varningen, eventuellt med en kommentar, så den inte ligger kvar. Avvakta tills varningarna använts en tid.

- ID: `01M6EXGZN5499V6KRVYAFGBA4B`
- Type: feature
- Actor: ai:claude-code

---

## [P3][todo] [gravregister] Prova rimlighetsregler i spec-prompten (gravregister_spec.md)

T.ex. 'dödsdatum kan inte ligga efter gravsättning; läs om siffran'. Påverkar även Claude och tömmer prompt-cachen, så mät på utvärderingsdatan för både gemma4 och Claude innan ändringen behålls.

- ID: `01M6EXGZMZC2F5H2JWAZ2KET4T`
- Type: spike
- Actor: ai:claude-code

---

## [P3][todo] [gravregister] Riktad omläsning när rimlighetskontrollen slår till (lokal modell)

När en rimlighetsregel slår till (t.ex. död efter gravsättning) frågar appen modellen en gång till om just den raden. Gratis lokalt. Mät först på utvärderingsdatan (scripts/lokal_ocr) att det rättar fler fel än det skapar. Exempel: HKG U 2, gemma läste dödsmånad 05, kortet säger 03.

- ID: `01M6EXGZMR6X15YS6RG2XE02BE`
- Type: spike
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Förslag på skissmarkering via bläckmätning i de tre förtryckta rutorna

Skissen = val bland tre förtryckta rutor (vänster kvadrat x~0,05, mitten x~0,46, prickad höger x~0,87; y~0,37, h~0,17). Mätning 2026-11-02 på 180 gravar: mittrutan skiljs perfekt (bläck >0,005 bara när markerad), vänster överlappar delvis med omarkerade (facit osäkert, äldre gravar transkriberades troligen före skissfunktionen). Ingen modell krävs; ev. gemma för gränsfall. Skript: scratchpad black.py (flytta till scripts/ vid start).

Kontaktark 2026-11-05 (prod, 254 skisser på 252 gravar): http://ubuntu-ai:8890/share/3c14a9c3f96f/skisser-kontaktark.html (städas efter TTL; skript i scratchpad kontakt/kontakt.py).
- Vänster ruta 242 st: x 0.04-0.06 (median 0.052), y 0.36-0.38 (median 0.372), 0.124 x 0.174.
- Mitten 11 st: x 0.46 (median 0.462), y 0.36-0.37, 0.069 x 0.181.
- Höger (prickad) 0 st. Extramaterial 1 st (egen ritad karta, HKG 05 31+32). Inga andra avvikare.
- Positionen är i praktiken fast per ruta, så förslaget kan använda fasta koordinater per ruta och behöver bara avgöra VILKEN ruta som är ifylld.
- Facit för 'ingen skiss' är opålitligt: av 817 färdiga har bara 251 skiss. Mapp 01-03 (tidiga HKG-transkriberingar) 57 av 543, mapp 24 (senare) 120 av 134. Skissfunktionen kom troligen efter de tidiga transkriberingarna. Mät träffsäkerhet mot mapp 24 och senare, inte mot HKG 01-03.

Rättelse samma dag (Rasmus påpekade HKN E 25+26): positionen är INTE fast i bredd. Överkant och höjd är fasta (y 0.356-0.377, h 0.167-0.199), men vänstra rutan förlängs för hand vid dubbelgravar. 12 av 242 är bredare än standard (8 i HKN D/E, t.ex. E 25+26 bredd 0.213 mot normala 0.124).
Mätning av högerkanten: den lodräta linje längst till höger i bandet y 0.40-0.52 som täcker över 85 % av höjden, sökt från x 0.44 (strax före mittrutan) och åt vänster. Den träffar 239 av 242 inom 0.02 av granskarens högerkant (99 %), inklusive alla förlängda rutor. De 3 avvikarna (HKG 19 29 'urnkammare', HKG 15 8 'urna', HKN Allm 1a '3 m') är rätt uppmätta: där drog granskaren ut markeringen för att ta med en anteckning till höger. Inte konsekvent, HKG 04 2 'Graven fullbelagd' togs inte med. Förslag: föreslå rutans kant, låt granskaren dra ut vid behov. Skript: scratchpad kontakt/kant.py.

Jämförelse 2026-11-05 på 33 markerade skisser (11 mitten, 12 förlängda, 10 vanliga), skissraden y 0.27-0.62 som indata, IoU mot granskarens markering (scratchpad kontakt/jamfor_bbox.py, bbox-resultat.json):
| Metod | Rätt ruta | IoU>=0.8 | IoU snitt | Tid |
| Bildmätning (bläck + lodrät högerkant) | 32/33 (33/33 med mittröskel 0.002) | 29/33 | 0.86 | ~0 s |
| qwen3-vl:8b-instruct (bbox 0-1000) | 33/33 | 13/33 | 0.76 | 1.4 s |
| gemma4:12b | 32/33 | 0/33 | 0.41 | 0.6 s |
| qwen2.5vl:7b | - | 0/33 | 0.02 | 1.2 s (ekade mallen, fel koordinater) |
Bildmätningens 4 missar: HKN A 67 (bara '1.' i mittrutan, bläck 0.0041 under tröskeln 0.005; omarkerade mittrutor ligger på 0.0000, så 0.002 är säkert) och de 3 där granskaren tog med en anteckning. Slutsats: bygg på bildmätning utan modell. Mittrutan om dess bläck > 0.002, annars vänster om den har bläck, annars inget förslag. Högerkant enligt lodrät linje. qwen3-vl kan användas som andra åsikt om valet av ruta, men behövs inte enligt mätningen.

Finns det en skiss alls? (2026-11-05, scratchpad kontakt/finns_skiss.py, 253 markerade + 14 omarkerade färdiga i mapp 24):
- qwen3-vl:8b-instruct: hittar bara 56/253, inga falsklarm. För försiktig, oanvändbar som detektor.
- Bläck (mitten > 0.002 eller vänster > tröskel): 0.001 hittar 249/253 med 4 'falsklarm', 0.002 hittar 242/253 med 3.
- 3 av 'falsklarmen' var riktiga skisser som saknade markering: HKN M 45 ('1.' + mellanvägg), M 48 ('1. 2.'), O 6 (bara en ritad mellanvägg). Bara HKN O 51 var tom (0.0015 = brus).
- Slutsats: bläck räcker. Vänster > 0.002 = skiss, 0.001-0.002 = 'kanske, granska', under = ingen. Ingen modell behövs för detektionen heller.
- Lärdom: scratchpad-skripten kör main() vid import. Det startade av misstag 99 modellanrop mot rasmus-dator3 under ett prod-anspråk. Nu vaktade.

- ID: `01M6EWGZE3QTC28QMGAYVQFRR9`
- Type: feature
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Bakgrundskörning av lokal OCR-batch på servern (utan öppen flik)

Batch körs i dag genom att webbläsaren anropar /nasta i en slinga. 3 200 gravar x ~8 s = ~7 h. Bygg en serverkörning som tål sidbyten och omstart, med paus/avbryt och anspråk i växeln. Del av TASK-3283.

Påbörjat: app/services/batch_korning.py (ej inkopplad).

Ingår också (Rasmus 2026-11-02):
- Byt sidans namn /batch-claude -> /batch-ai, med omdirigering från den gamla adressen (prod har fler användare med bokmärken). API-sökvägarna /api/batch-claude/* kan ligga kvar.
- Granska och skriv om batch-sidans texter för både Claude och lokal modell: ingressen 'Kör Claude OCR automatiskt', tabellen Realtid/Batch API, kostnadspanelen (döljs för lokal), startsidans länktext 'Batch Claude OCR', rubriken i gravvyns batch-banner.

- ID: `01M6EWGZDX9PH4NSW9009Z28P8`
- Type: feature
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Status 'AI-läst, ej granskad' (lila) i listor, träd och startsidans staplar

Härleds ur sparade OCR-svar (claude_ocr_svar/lokal_ocr_svar) för gravar utan färdig transkribering. Skrivs INTE in i gravplats_inmatning, så /yrken och prestationer inte får overifierad data. Lila färg i startsidans diagram enligt Rasmus. Del av spåret lokal OCR (TASK-3283).

- ID: `01M6EWGZDQB6QEWHX3C7FSBR7B`
- Type: feature
- Actor: ai:claude-code

---

## [P3][done] [gravregister] Lokal modell för OCR-igenkänning (rasmus-dator3 via portalens växel :8890), facit mot granskade/Claude-körningar, bedöm KB-BERT

Klart och i prod 2026-11-02 (1716f55): lokal OCR med gemma4:12b via portalens växel, bakgrundsbatch med kö och sluttid, svar sida vid sida, rimlighetsvarningar, osäkra siffror (logprobs), lila status 'AI-läst, ej granskad', förslagsläge och mobilvy. Utvärdering: backlog doc 'Lokal OCR - utvärdering och implementation 2026-11-02'. KB-BERT bedömd som onödig. Uppföljning i TASK-3286..3290.

- ID: `01M6ER522XWBR4131DCC3YSHSW`
- Type: spike
- Actor: ai:claude-code

---

