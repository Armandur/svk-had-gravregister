# Specifikation – Gravregisterkort från Härnösands domkyrkoförsamling (Skandix/Remington System Sy)

Denna specifikation beskriver **arkivformatet** för gravregisterkort från Härnösands domkyrkoförsamling, enligt systemet Skandix/Remington System Sy. Den bygger på den **allmänna modellen** (se [specifikation-generell.md](specifikation-generell.md)) och anger här det som är specifikt för detta källdata: källmaterial, sidlayout, kyrkogårdar/kvarter, beskärning och specialfall.

---

## 1. Källmaterial

- **Format:** En PDF-fil per sida i det fysiska gravregistret.
- **Numrering:** PDF-filerna (1.pdf, 2.pdf, …) är numrerade i samma ordning som sidorna i registret.
- **Typ:** Skannade bilder – text måste extraheras med OCR.

---

## 2. Mappar och kontext (kyrkogård, gravkvarter)

På varje gravplats är endast **gravplatsnumret** angivet i själva registret. **Kyrkogård** och **gravkvarter** framgår av **mappens namn** där PDF-filerna ligger:

- **Kyrkogård:** HKG eller HKN.
- **Gravkvarter:**  
  - HKG: 1–24, samt U.  
  - HKN: t.ex. Allm, A, D, E, F, G, H, J, L, M, N, O.

**Första gången en mapp öppnas** anger användaren kyrkogård och (standard) gravkvarter. **Gravkvarter** gäller oftast för hela mappen men inte alltid – användaren ska kunna **ändra gravkvarter** när det byts till ett nytt kvarter i registret (utan att byta mapp).

**Försättssidor:** I början av en mapp kan det finnas **en eller två försättssidor** (omslag/titelsidor för arkivvolymen) som inte tillhör gravregistret. Användaren ska kunna ange antal försättssidor (0, 1 eller 2) så att bläddringen med "tre sidor per gravplats" startar *efter* dessa.

---

## 3. Struktur per gravplats (tre sidor)

En gravplats använder **tre sidor** (tre PDF-filer) med följande layout:

### Sida 1

| Del | Innehåll |
|-----|----------|
| **Övre halvan** | Platser för gravsatta 6–10 på den **föregående** gravplatsen. (På allra första sidan i registret finns ingen föregående grav – då är övre halvan tom.) |
| **Nedre halvan** | Uppgifter om gravrättsinnehavare och gravplatsnummer för den **aktuella** graven (fält enligt allmänna modellen). |

### Sida 2

| Del | Innehåll |
|-----|----------|
| **Övre halvan** | Tom. |
| **Nedre halvan** | Gravsatta 1–5 för den aktuella gravplatsen. |

### Sida 3

| Del | Innehåll |
|-----|----------|
| **Övre halvan** | Platser för gravsatta 6–10 på den **aktuella** gravplatsen. |
| **Nedre halvan** | Uppgifter om **nästa** gravplats (gravrättsinnehavare m.m.). |

### Beskärning (splits) för visning

"Övre" och "nedre" del är **inte** exakt 50/50 av sidan – andelarna är uppmätta från det skannade formatet (vid 150 DPI, typisk sidstorlek ca 1240×1600 px):

- **Sida 1 och sida 3:** Den **övre** relevanta delen är från toppen till ca **45,5 %** av sidhöjden (727/1597 ≈ 0,455). Nedre delen = från 45,5 % till botten.
- **Sida 2:** Den **nedre** relevanta delen börjar vid ca **54,5 %** av sidhöjden (870/1595 ≈ 0,545) och går till botten. Övre delen = tom.

Vid skannade arkiv med annan upplösning eller layout kan proportionerna justeras per mapp.

---

## 4. Fältordning (detta format)

På **nedre halvan sida 1** står i källmaterialet följande rubriker i fallande ordning. I systemet sorteras de in under **Gravplats**, **Gravrättsinnehavare** respektive **Närmast anhörig** enligt allmänna modellen:

| Rad | Rubrik i källan | Hör till |
|-----|-----------------|----------|
| 1 | Gravrättsinnehavare | Gravrättsinnehavare |
| 2 | Yrke | Gravrättsinnehavare |
| 3 | Adress | Gravrättsinnehavare |
| 4 | Närmast anhörig | Närmast anhörig (eget block) |
| 5 | Storlek | Gravplats |
| 6 | En skiss på gravplatsen | Gravplats |
| 7 | Underhåll inbetalt för all framtid den *(ev. "för all framtid" överstruket)* | Gravplats |
| 8 | Gravrättstid | Gravplats |
| 9 | Monument | Gravplats |
| 10 | Gravens utformning | Gravplats |
| Bottenkant | Gravplats nr, Karta nr, Gravbrev nr, Utfärdat den | Gravplats |

Gravplatsnumret finns endast på bottenkanten, inte på andra delar av sidan.

**Gravsatta** (sida 2 nedre = position 1–5, sida 3 övre = position 6–10): Namn, Adress, Födelse (år, månad, dag, föd.nr), Dödsår/månad/dag, Dödsbok nr, Gravsatt den, Urna. *(Se allmänna modellen för beteckning, kommentar och tvingande fält.)*

---

## 5. Användargränssnitt (detta format)

- **Tre delar:** Del 1 = Gravrättsinnehavare + gravplatsnr (nedre sida 1). Del 2 = Gravsatta 1–5 (nedre sida 2). Del 3 = Gravsatta 6–10 (övre sida 3).
- **Layout:** Horisontellt (tre rutor bredvid varandra) eller vertikalt (staplade).
- **Bläddring:** Nästa gravplats = vyn flyttas **två** innehållssidor framåt (tidigare sida 3 blir sida 1 för nästa grav). Föregående = två sidor bakåt.
- **Länk till källa:** Länk till motsvarande PDF-fil i rubriken för varje del.
- **Skärmutrymme:** Kompakt topprad för mapp, kyrkogård, gravkvarter, försättssidor; huvudparten av skärmen till PDF-innehållet.
- **Prestanda:** Cachning och preload av angränsande sidor rekommenderas.

**Spårbarhet:** Varje gravplats kopplas till de tre innehållssidorna (mapp + start_sida) och eventuellt extramaterial.

---

## 6. Specialfall (detta format)

- **Färre än 6 gravsatta:** Raderna för gravsatta 6–10 används inte (övre halvan sida 3 tom).
- **Underhåll – "för all framtid" överstruket:** Om texten "för all framtid" är överstruken betyder det att underhållet bara gällde viss tid. Ska kunna anges i digitaliseringen.
- **Gravplatsnummer med intervall eller plus:** T.ex. **1-2**, **1+2**, **7+8** i källan. Samma tre-sidorsstruktur gäller; det är en namngivning i registret.
- **Överstrukna och handskrivna positionsnummer:** Tryckta siffror (1–5 på sida 2, 6–10 på sida 3) kan vara överstrukna och ersatta med handskrivna. Inmatningen ska återspegla den ordning som avses; använd kommentar för att förtydliga källan.
- **Övre del av sida 1 använd för nästa grav:** När en grav har färre än 6 gravsatta kan den **övre delen av nästa gravs sida 1** användas för ytterligare gravsatta för nästa gravplats. Källmaterialet är då utspritt över flera sidor – bläddra och mata in enligt vilken gravplats personerna tillhör; använd kommentar vid behov.
- **Extramaterial:** PDF:er som inte följer tre-sidorsstrukturen plockas ur sidräkningen och kopplas till gravplats eller mapp. Exempel: **lapp** (adressuppgift), **brev** (t.ex. till kyrkogårdsvaktmästaren), **karta** (placeringar i graven). Typ är valfri fritext.
- **Övriga avvikelser** (handskrivna tillägg, överstrukna rader, ofullständig data) dokumenteras i kommentarsfält.

---

*Specifikationen gäller gravregisterkort från Härnösands domkyrkoförsamling (Skandix/Remington System Sy). Revideras vid behov.*
