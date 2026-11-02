# Backlog Export

## [P3][todo] [gravregister] Datakvalitet: 11 granskade gravar bryter mot rimlighetsreglerna

Mätning 2026-11-02 på prod-kopian: gravplats 120, 387, 420 (död före födsel), 223, 404 (över 110 år), 536, 2235 (ogiltigt dödsdatum), 3884, 485, 3980, 3997 (gravsatt före död). Antingen fel på korten eller vid granskning. Visa dem på datakvalitetssidan med samma regler som OCR-varningarna.

- ID: `01M6EXGZNBDX9QNDFEYBKF7ZEZ`
- Type: task
- Actor: ai:claude-code

---

## [P3][todo] [gravregister] Godkänna en rimlighetsvarning som korrekt (kortet har faktiskt felet) med kommentar

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

## [P3][todo] [gravregister] Förslag på skissmarkering via bläckmätning i de tre förtryckta rutorna

Skissen = val bland tre förtryckta rutor (vänster kvadrat x~0,05, mitten x~0,46, prickad höger x~0,87; y~0,37, h~0,17). Mätning 2026-11-02 på 180 gravar: mittrutan skiljs perfekt (bläck >0,005 bara när markerad), vänster överlappar delvis med omarkerade (facit osäkert, äldre gravar transkriberades troligen före skissfunktionen). Ingen modell krävs; ev. gemma för gränsfall. Skript: scratchpad black.py (flytta till scripts/ vid start).

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

## [P3][doing] [gravregister] Lokal modell för OCR-igenkänning (rasmus-dator3 via portalens växel :8890), facit mot granskade/Claude-körningar, bedöm KB-BERT

Utvärdering klar (backlog doc 'Lokal OCR - utvärdering och implementation 2026-11-02'): gemma4:12b valdes. Implementation (flagga lokal_ocr_aktiv, enskild + batch, logg per modell) väntar på Rasmus test innan commit. KB-BERT bedömd som onödig i detta steg.

- ID: `01M6ER522XWBR4131DCC3YSHSW`
- Type: spike
- Actor: ai:claude-code

---

