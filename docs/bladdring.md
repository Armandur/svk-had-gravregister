# Bläddring och visning

## Val av mapp

Under **källdata** finns en undermapp per arkiv (kyrkogård/gravkvarter). Varje mapp innehåller PDF-filer numrerade som sidorna i det fysiska registret (1.pdf, 2.pdf, …).

När du väljer mapp anger du:

- **Kyrkogård** (t.ex. HKG, HKN)
- **Gravkvarter** (t.ex. 1–24, U för HKG; Allm, A, D, … för HKN)
- **Försättssidor:** Antal sidor i början som inte tillhör gravregistret (0, 1 eller 2). Bläddringen med "tre sidor per gravplats" startar efter dessa.

Du kan ändra gravkvarter när du bläddrar om registret byter kvarter inom samma mapp.

## Tre delar per gravplats

Varje gravplats använder tre PDF-sidor:

1. **Del 1:** Gravrättsinnehavare och gravplatsnummer (nedre halvan av sida 1).
2. **Del 2:** Gravsatta 1–5 (nedre halvan av sida 2).
3. **Del 3:** Gravsatta 6–10 (övre halvan av sida 3).

Layouten kan visas horisontellt (tre rutor bredvid varandra) eller vertikalt (staplade). I rubriken för varje del finns en länk till motsvarande PDF-fil.

## Bläddring

- **Nästa gravplats:** Flyttar vyn två innehållssidor framåt (tidigare sida 3 blir nu sida 1 för nästa grav).
- **Föregående gravplats:** Flyttar vyn två sidor bakåt.

Beskärning (övre/nedre halva) följer de andelar som anges i specifikationen och kan justeras per mapp om källmaterialet avviker.

## Kortkommandon

En knapp med symbolen ⌨ i menyraden (eller tangenten `?`) öppnar en dialog med alla kortkommandon. Genvägarna fungerar när fokus inte ligger i ett inmatningsfält. Trycker man `Escape` i ett inmatningsfält tappar fältet fokus, så att nästföljande tangenttryck triggar genvägar igen. Kortkommandon för funktioner som kräver särskild behörighet (Claude, Historik) visas bara i dialogen om användaren har tillgång till dem.

| Tangent | Funktion |
|---|---|
| `←` / `→` | Föregående / nästa gravplats (blockeras om det finns osparade ändringar – se [Osparade ändringar](inmatning.md#osparade-ändringar)) |
| `E` | Redigera / visa gravplatsen |
| `F` | Växla färdigtranskriberad |
| `H` | Visa / dölj hela sidan |
| `V` | Växla horisontell / vertikal vy |
| `R` | Öppna rapportutskrift |
| `S` | Lägg till skiss |
| `C` | Hämta från Claude (kräver redigeringsläge; visas ej om Claude ej är tillgänglig) |
| `I` | Öppna redigeringshistorik (visas ej om ej admin) |
| `Ctrl`+`S` | Spara inmatning (kräver redigeringsläge) |
| `?` | Visa kortkommandon |

**I bildförstoring:**

| Tangent | Funktion |
|---|---|
| `←` / `→` | Föregående / nästa bild |
| `+` / `−` | Zooma in / ut |
| `Esc` | Stäng |

## Bildförstoring (lightbox)

Klicka på en bild för att öppna den i helskärmsläge. Bilden visas initialt i fit-läge (skalas för att fylla fönstret).

- **Zooma:** Scrollhjulet zoomar mot muspekaren. Knapparna `+`/`−` i zoomkontrollen zoomar mot mitten. Zoomnivå visas i procent (100% = naturlig pixelstorlek).
- **Panorera:** Klicka och dra för att flytta runt i bilden när den är inzoomad. Fungerar även med touch (ett finger).
- **Navigera:** Pil-knapparna (eller `←`/`→`) bläddrar mellan bilder i samma set.
- **Stäng:** Klicka utanför bilden, tryck `Esc`, eller använd stängknappen.
