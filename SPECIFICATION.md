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

**Första gången en mapp öppnas** ska användaren ange vilken kyrkogård och vilket gravkvarter som gäller för allt innehåll i mappen. Denna information sparas och används för alla gravplatser i mappen (tills användaren byter mapp eller anger annat).

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



---

## 4. Fält – Gravrättsinnehavare (nedre halvan)

Rubriker i **fallande rader** (ovanifrån och nedåt):

1. Gravrättsinnehavare  
2. Yrke  
3. Adress  
4. Närmast anhörig  
5. Storlek  
6. En skiss på gravplatsen *(lagras i databasen som bild)*  
7. Underhåll inbetalt för alla framtid den *(ibland är "för all framtid" överstruket – då gällde underhållet bara viss tid)*  
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

- Programmet visar **3 PDF-sidor åt gången**:
  - **Sida 1:** Övre halvan = gravsatta 6–10 föregående grav (tom på första gravplatsen). Nedre halvan = gravrättsinnehavare + gravplatsnr för aktuell grav.
  - **Sida 2:** Övre halvan = tom. Nedre halvan = gravsatta 1–5 för aktuell grav.
  - **Sida 3:** Övre halvan = gravsatta 6–10 för aktuell grav. Nedre halvan = uppgifter om nästa gravplats.

- När användaren har matat in eller korrigerat all data för en gravplats går man vidare till **nästa** gravplats. Då “glider” fönstret:
  - Tidigare sida 3 blir nu **första** visade sidan.
  - Därefter visas sidorna 4 och 5.

Så fortsätter sekvensen: alltid tre på varandra följande sidor (sida 1 = gravrätt aktuell grav, sida 2 = gravsatta 1–5, sida 3 = gravsatta 6–10 + gravrätt nästa grav).

---

## 7. Lagring och export

- **Primär lagring:** Databas.
- **Skiss på gravplatsen:** Lagras som **bild** i databasen (extraheras/inskannas från källan).
- **Export/import:** Stöd för t.ex. JSON (och vid behov andra format).
- **Kommentarer:** Möjlighet till en **kommentarsruta** per digitaliserad gravplats (för handskrivna tillägg, osäkerheter, undantag m.m.).
- **Spårbarhet till källa:** Alla uppgifter som digitaliseras ska kunna **härledas tillbaka till respektive PDF-fil**. Varje post (gravplats, gravrättsinnehavare, gravsatt person, fältvärde) ska kunna kopplas till vilken PDF-fil och – vid behov – vilken del av sidan (övre/nedre halva) som källan kommer från.

---

## 8. Specialfall

- **Färre än 6 gravsatta:** Raderna för gravsatta 6–10 används inte (övre halvan tom).
- **Gravbeteckning på position 1:** I vissa fall har gravsatt position 1 använts för en beteckning på graven (t.ex. "Per Augusts familjegrav") i stället för en person. Den första faktiska gravsatta personen står då från position 2. Programmet ska tillåta att position 1 används antingen som person eller som beteckning/benämning.
- **Underhåll – "för all framtid" överstruket:** Om texten "för all framtid" är överstruken betyder det att underhållet bara gällde viss tid (inte för all framtid). Detta ska kunna anges/registreras i digitaliseringen.
- **Övriga avvikelser** (handskrivna tillägg, överstrukna rader, ofullständig data) kan dokumenteras i kommentarsfältet för den aktuella graven.

---

*Specifikationen baserad på användarens beskrivning. Revideras vid behov.*
