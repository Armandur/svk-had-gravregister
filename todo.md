# Todo: Extrahera hel adressrad till Gatuadress, Postnummer, Postort (OCR)

**Branch:** `dev-full-adress-ocr-extract`

## Syfte
På samma sätt som knapparna **EF** och **FE** (Efternamn/Förnamn) fungerar för namnfält ska användaren kunna extrahera en hel adressrad in i fälten **Gatuadress**, **Postnummer** och **Postort**.

## Flöde (översikt)
1. Användaren fokuserar ett adressfält (t.ex. Gatuadress) eller har adressfälten i fokus – visa en knapp/ikon typ "Adress" (liknande EF/FE).
2. Användaren klickar på knappen → väntar på bildmarkering (samma flöde som EF/FE: markera område på bild).
3. OCR körs på det markerade området → en modal visas (liknande namn-split-modalen för EF/FE).
4. I modalen: användaren **markerar avgränsningen** mellan **Gatuadress** och **Postnummer** (t.ex. klick mellan tecken, som i `showOcrModalNamnSplit`).
5. Efter användarens delning:
   - **Gatuadress** = texten före den markerade avgränsningen (trimmas).
   - **Postnummer** och **Postort** parsas automatiskt från texten **efter** avgränsningen enligt nedan.

## Automatisk parsing av Postnummer och Postort
- Format som gäller: `NNN NN POSTORT` (fem siffror, mellanslag, postort).
- Om postnumret är ihopskrivet som `NNNNN` (fem siffror utan mellanslag) ska det **normaliseras** till `NNN NN` (tre siffror, mellanslag, två siffror).
- Allt efter de fem siffrorna (ev. efter normalisering) tolkas som **Postort**.

## Teknisk referens
- **EF/FE-flöde:** `static/gravplatser.js` – `ocrNamnLage`, `showOcrModalNamnSplit()`, `visaOcrIkonForFalt()`, `arNamnFaltForOcr()`, `getNamnParFalt()`. Knappar: `gpOcrBtnEf`, `gpOcrBtnFe`.
- **Modal:** `static/gravplatser-visa.html` – `#gp-ocr-modal`, `#gp-ocr-modal-namn` med `#gp-ocr-namn-text` (klickbara split-positioner). CSS: `static/gravplatser.css` – `.gp-ocr-namn-split`, `.gp-ocr-namn-char`.
- **Adressfält som ska fyllas:**  
  - Innehavare: `inv_gatuadress`, `inv_postnummer`, `inv_postort`  
  - Närstående: `na_gatuadress`, `na_postnummer`, `na_postort`  
  - Gravsatta: `gs_gatuadress_${idx}`, `gs_postnummer_${idx}`, `gs_postort_${idx}`

## Uppgifter (för implementering)
- [x] Avgör om adress-knappen visas vid fokus på något av de tre fälten (Gatuadress, Postnummer, Postort) eller bara Gatuadress; skapa `arAdressFaltForOcr()` och ev. `getAdressTrioFalt(element)` (returnerar { gatuadress, postnummer, postort }).
- [x] Visa "Adress"-knapp (eller ikon) vid adressfält, samma plats som EF/FE vid namnfält – antingen återanvänd `gp-ocr-falt-wrap` / `gp-ocr-falt-ikon-grupp` eller lägg till en separat knapp för adress.
- [x] När användaren klickar "Adress" → sätt t.ex. `ocrAdressLage = true` (eller eget läge) och `ocrVantarPaBild = true`; vid OCR-klar, anropa ny funktion typ `showOcrModalAdressSplit(text)`.
- [x] Implementera `showOcrModalAdressSplit(text)`: samma UI som namn-split (text med klickbara positioner mellan tecken). Vid klick på position `i`: gatuadress = `text.slice(0, i).trim()`, rest = `text.slice(i)`; parsera rest till postnummer + postort (normalisera NNNNN → NNN NN, postort = resten).
- [x] Fyll de tre fälten i aktuell rad (innehavare/närstående/gravsatt) utifrån `ocrTargetElement`; använd `getAdressTrioFalt(ocrTargetElement)` för att hitta DOM-elementen.
- [x] Hantera Escape/Avbryt och återställ modal till vanligt läge; återställ `ocrAdressLage` etc. vid stängning.

## Antaganden
- En adressrad på bilden är typiskt en rad text (gatuadress, eventuellt postnummer och postort på samma rad).
- Svenska postnummer är fem siffror (format NNN NN). Ingen validering mot officiell lista krävs för denna todo; normalisering av mellanslag räcker.

---
*Skapad för att återupptas i branchen `dev-full-adress-ocr-extract`.*
