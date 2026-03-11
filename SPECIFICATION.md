# Specifikation: Digitalisering av gravregister

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

**Försättssidor:** I början av en mapp kan det finnas **en eller två försättssidor** (omslag/titelsidor för arkivvolymen) som inte tillhör gravregistret. Användaren ska kunna ange antal försättssidor (0, 1 eller 2) så att bläddringen med "tre sidor per gravplats" startar *efter* dessa – man ska alltså kunna "bläddra förbi" försättssidorna utan att de räknas in i sidnumreringen för gravplatser.

---

## 3. Struktur per gravplats

En gravplats använder **tre sidor** (tre PDF-filer) med följande layout:

### Sida 1

| Del | Innehåll |
|-----|----------|
| **Övre halvan** | Platser för gravsatta 6–10 på den **föregående** gravplatsen. (På allra första sidan i registret finns ingen föregående grav – då är övre halvan tom.) |
| **Nedre halvan** | Uppgifter om gravrättsinnehavare och gravplatsnummer för den **aktuella** graven (se avsnitt 4). |

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

"Övre" och "nedre" del är **inte** exakt 50/50 av sidan – andelerna är uppmätta från det skannade formatet (vid 150 DPI, typisk sidstorlek ca 1240×1600 px):

- **Sida 1 och sida 3** (gravrättsinnehavare respektive gravsatta 6–10): Den **övre** relevanta delen är från toppen till ca **45,5 %** av sidhöjden (mätt som 727 px av 1597 px). Nedre delen = från 45,5 % till botten. *Split = 727/1597 ≈ 0,455.*
- **Sida 2** (gravsatta 1–5): Den **nedre** relevanta delen börjar vid ca **54,5 %** av sidhöjden (mätt som 870 px av 1595 px) och går till botten. Övre delen = tom. *Split = 870/1595 ≈ 0,545.*

Vid visning av endast "relevanta delar" ska dessa andelar användas så att rätt innehåll beskärs. Vid skannade arkiv med annan upplösning eller layout kan proportionerna behöva justeras.

---

## 4. Fält – Gravrättsinnehavare (nedre halvan)

Rubriker i **fallande rader** (ovanifrån och nedåt):

1. Gravrättsinnehavare  
2. Yrke  
3. Adress  
4. Närmast anhörig  
5. Storlek  
6. En skiss på gravplatsen *(lagras i databasen som bild)*  
7. Underhåll inbetalt för all framtid den *(ibland är "för all framtid" överstruket – då gällde underhållet bara viss tid)*  
8. Gravrättstid  
9. Monument  
10. Gravens utformning  

**Längst ned längs bottenkanten**, från vänster till höger:

- Gravplats nr  
- Karta nr  
- Gravbrev nr  
- Utfärdat den  

**Obs:** Gravplatsnumret finns endast här (längs bottenkanten på “sida 1” för gravplatsen), inte på andra delar av sidan.

---

## 5. Fält – Gravsatta

Gravsatta 1–5 finns på **sida 2 (nedre halvan)**. Gravsatta 6–10 finns på **sida 3 (övre halvan)**. För **varje** gravsatt person (1–10) samma rubriker:

- Namn  
- Adress  
- Födelse år, månad, dag  
- Föd. nr  
- Dödsår, månad, dag  
- Dödsbok nr (db. nr)  
- Gravsatt den  
- Urna *(kan anges i vissa fall)*  

**Tvingande fält:** Endast de fält som ofta förekommer i källmaterialet behöver vara obligatoriska vid inmatning. Födelsemånad, födelsedag, dödsmånad, dödsdag, föd.nr och db.nr är **inte** tvingande – dessa kan vara tomma.  

---

## 6. Användargränssnitt (visning av PDF:er)

- Programmet visar för varje gravplats **tre delar** (samma innehåll som avsnitt 3, eventuellt beskuret enligt avsnitt 3):
  - **Del 1:** Gravrättsinnehavare + gravplatsnr (nedre del av sida 1).
  - **Del 2:** Gravsatta 1–5 (nedre del av sida 2).
  - **Del 3:** Gravsatta 6–10 (övre del av sida 3).

- **Layout:** Samma tre delar ska kunna visas antingen **horisontellt** (tre rutor bredvid varandra) eller **vertikalt** (staplade). Innehållet är identiskt – endast layouten skiljer.

- **Bläddring:** När användaren går till **nästa** gravplats flyttas vyn **två** innehållssidor framåt: tidigare sida 3 blir nu sida 1 (info om nästa grav), därefter sida 2 och 3. Vid **föregående** gravplats flyttas vyn två sidor bakåt.

- **Länk till källa:** I rubriken för varje del ska det finnas en länk till motsvarande PDF-fil (t.ex. filnamn högerställt), så att källan alltid går att öppna.

- **Skärmutrymme:** Huvudparten av skärmen ska användas till själva PDF-innehållet. Val av mapp, kyrkogård, gravkvarter och försättssidor kan ligga i en **kompakt topprad** så att läsningen prioriteras.

- **Prestanda (rekommendation):** Genererade bilder kan cachas (t.ex. Cache-Control) och bilder för angränsande gravplatser kan preloadas i bakgrunden för snabbare bläddring.

---

## 7. Lagring och export

- **Primär lagring:** Databas. Gravplatser, gravsatta, gravrättsinnehavare samt **extramaterial** (vilka PDF:er som är extramaterial, valfri typ-beteckning och antingen koppling till en gravplats eller endast till mappen) lagras här och matas in via programmet så att bläddring och koppling till källor fungerar.
- **Skiss på gravplatsen:** Lagras som **bild** i databasen (extraheras/inskannas från källan).
- **Adress:** Adress kan lagras och visas som **Gatuadress**, **Postnummer** och **Postort** (för gravrättsinnehavare, närmast anhörig och gravsatta).
- **Kommentarer:** Möjlighet till kommentar **per gravplats** (för handskrivna tillägg, osäkerheter, undantag). Kommentar kan även anges **per gravrättsinnehavare**, **per närmast anhörig** och **per gravsatt**.
- **Export/import:** Stöd för t.ex. JSON (och vid behov andra format).
- **Spårbarhet till källa:** Varje gravplats är kopplad till de PDF-filer som utgör dess tre innehållssidor (mapp + start_sida) och eventuellt extramaterial. Det räcker för att kunna granska och verifiera digitaliseringen; enskilda fält behöver inte kopplas till specifik sida eller halva.

---

## 8. Specialfall

- **Färre än 6 gravsatta:** Raderna för gravsatta 6–10 används inte (övre halvan tom).
- **Gravbeteckning (beteckning istället för person):** En gravsatt position (1–10) kan användas för en beteckning på graven (t.ex. "Per Augusts familjegrav") i stället för en person. Programmet ska tillåta att **vilken position som helst** används antingen som person eller som beteckning/benämning.
- **Underhåll – "för all framtid" överstruket:** Om texten "för all framtid" är överstruken betyder det att underhållet bara gällde viss tid (inte för all framtid). Detta ska kunna anges/registreras i digitaliseringen.

- **Gravplatsnummer med intervall eller plus:** Gravplatsnumret behöver inte vara en enskild siffra – i källan kan det anges som t.ex. **1-2**, **1+2**, **7+8** osv. Samma tre-sidorsstruktur gäller; det är alltså en namngivning i registret, inte att gravar “slås ihop” som specialfall.

- **Överstrukna och handskrivna positionsnummer:** De tryckta siffrorna för gravsatta (1–5 på sida 2, 6–10 på sida 3) kan vara **överstrukna och ersatta med handskrivna siffror**. Den handskrivna siffran anger den faktiska ordningen eller vilken “plats” personen har; den tryckta platsen på pappret behöver alltså inte motsvara den logiska positionen. Exempel: på sida 2 står (överstruket 1, handskriven 6), (överstruket 2, handskriven 5), … – då ska inmatningen kunna återspegla den ordning/numrering som avses (t.ex. gravsatt 1–6 med info från rätt rader).

- **Övre del av “sida 1” använd för nästa grav:** När en grav har **färre än 6 gravsatta** används inte den övre halvan av “sida 3” för den graven. I stället kan den **övre delen av nästa gravs “sida 1”** (normalt reserverad för föregående gravs 6–10) användas för att ange ytterligare gravsatta för den **nästa** gravplatsen (t.ex. grav 7+8). Då kan t.ex. “6” vara överstruket och “3” handskrivet – alltså en tredje gravsatt för den aktuella gravplatsen, inmatad i 6–10-fältet på föregående gravs sida. Källmaterialet är alltså utspritt över flera sidor.

**Hantering vid inmatning:** Det räcker att användaren kan **bläddra** mellan gravplatserna i källvyn, samla in uppgifter från de sidor där personerna faktiskt står (även om de ligger på “fel” sida i förhållande till standardlayouten), och sedan **föra in varje gravsatt på den gravplats de tillhör** i inmatningsformuläret. Varje post kan kopplas till källan (vilken PDF och vilken del). Kommentarsfältet kan användas för att anteckna t.ex. “gravsatt 3 enl. övre del 13.pdf, handskriven numrering”.

- **Extramaterial:** I mappen kan det finnas PDF:er som **inte** följer den vanliga tre-sidorsstrukturen. Dessa ska kunna **plockas ur spannet** (exkluderas från den normala sidräkningen) och antingen **kopplas till en specifik gravplats** eller **endast till mappen**. Exempel på gravkopplat extramaterial:
  - **Lapp:** En eller fler sidor med t.ex. adressuppgift (”Elin Tynelius ddb c/o Hr A. Tynelius …”) – kan vara 165.pdf, 166.pdf som hör till en specifik grav.
  - **Brev:** T.ex. brev till kyrkogårdsvaktmästaren som hör till graven på 191–193.pdf (brevet kan ligga på 189.pdf, 190.pdf).
  - **Karta:** Mer specifik karta över placeringar i graven – t.ex. 203.pdf, 204.pdf som hör till graven på 205–207.pdf.
Varje sådan PDF kan antingen **kopplas till en specifik gravplats** (visas under "Extramaterial för denna gravplats") eller **endast till mappen** – t.ex. tom sida eller försättssidor; då kan användaren **visa extramaterial knutet endast till mappen** i en egen lista. **Typ** är valfri fritext (t.ex. lapp, brev, karta) eller obehållen. Systemet exkluderar alla extramaterial från sidflödet vid bläddring.



- **Övriga avvikelser** (handskrivna tillägg, överstrukna rader, ofullständig data) kan dokumenteras i kommentarsfältet för den aktuella graven.

---

*Specifikationen baserad på användarens beskrivning. Revideras vid behov.*
