# Grunddata och kyrkogårdar

## Kyrkogårdar

Kyrkogårdar (t.ex. HKG, HKN) konfigureras i **Grunddatahantering → Kyrkogårdar**. De används vid val av mapp (kyrkogård och gravkvarter) och i sökningar. Listan över tillgängliga kyrkogårdar kan styras via konfiguration (miljövariabeln `KYRKOGARDAR`).

## Användare och roller

- **Admin:** Kan hantera användare (Användarhantering), grunddata, loggar och databasunderhåll.
- **Vanlig användare:** Kan bläddra, söka, mata in och redigera gravplatser enligt sina rättigheter.

Första användaren skapas som admin. I produktion ska du sätta `SESSION_SECRET_KEY` och eventuellt `ADMIN_INITIAL_PASSWORD` vid första start.

## Databasunderhåll

Under **Databasunderhåll** (admin) finns verktyg för att t.ex. hitta gravplatser som saknar postnummer/ort och andra underhållsåtgärder. Använd dessa enligt instruktionerna i gränssnittet.

## Loggar

**Loggar** visar redigeringslogg för gravplatser (vem ändrade vad och när). Användbart för spårbarhet och granskning.
