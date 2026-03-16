# Grunddata och kyrkogårdar

## Kyrkogårdar

Kyrkogårdar (t.ex. HKG, HKN) konfigureras i **Grunddatahantering → Kyrkogårdar**. De används vid val av mapp (kyrkogård och gravkvarter) och i sökningar. Listan över tillgängliga kyrkogårdar kan styras via konfiguration (miljövariabeln `KYRKOGARDAR`).

## Användare och roller

- **Admin:** Kan hantera användare (Användarhantering), grunddata, loggar och databasunderhåll.
- **Vanlig användare:** Kan bläddra, söka, mata in och redigera gravplatser enligt sina rättigheter.

Första användaren skapas som admin. I produktion ska du sätta `SESSION_SECRET_KEY` och eventuellt `ADMIN_INITIAL_PASSWORD` vid första start.

## Databasunderhåll

Under **Databasunderhåll** (admin) finns verktyg för att t.ex. hitta gravplatser som saknar postnummer/ort och andra underhållsåtgärder. Använd dessa enligt instruktionerna i gränssnittet.

## Säkerhetskopior

Under **Inställningar → Säkerhetskopior** (admin) kan du ladda ned en kopia av databasen. Filnamnet innehåller datum, tid, branch och commit för spårbarhet. Säkerhetskopiera regelbundet, särskilt innan databasunderhåll.

## Loggar

**Loggar** visar redigeringslogg för gravplatser (vem ändrade vad och när). Användbart för spårbarhet och granskning.

## Yrken

Under **Yrken** (länk från sidan **Prestationer**) visas en lista med alla unika yrken som registrerats i systemet. Används för att få en överblick av yrkesvariationen i gravregistret.

## Prestationer

Varje inloggad användare kan se sina egna transkriberings­statistik och utmärkelser under **Prestationer** (länk i sidhuvudet på gravplats­sidan). Admins kan justera gränserna för utmärkelserna under **Inställningar → Admin → Justera prestationsgränser**.
