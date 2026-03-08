# Kör Gravregister i Docker (t.ex. på Unraid)

## Bygg image

**Alternativ 1 – Hämta färdig image från GitHub (CI bygger vid varje push till main):**

```bash
docker pull ghcr.io/<din-org-eller-användare>/svk-had-gravregister:latest
docker tag ghcr.io/<din-org-eller-användare>/svk-had-gravregister:latest gravregister
```

Byta `<din-org-eller-användare>` mot ditt GitHub-användarnamn eller org (t.ex. `mycompany`). För privata repon: `docker login ghcr.io` med ett Personal Access Token med scope `read:packages`.

**Alternativ 2 – Bygg lokalt:**

```bash
docker build -t gravregister .
```

## Volymer

Containern förväntar sig en **data-katalog** (t.ex. `/data`) som innehåller:

- **`gravregister.db`** – SQLite-databasen (skapas automatiskt om den saknas)
- **`källdata/`** – mapp med undermappar per PDF-arkiv (kyrkogård/gravkvarter). Varje undermapp innehåller PDF-filer.

Sätt miljövariabeln `DATA_DIR` till sökvägen till denna katalog i containern (standard i Dockerfile: `/data`).

## Miljövariabler

| Variabel | Beskrivning |
|---------|-------------|
| `DATA_DIR` | Sökväg till data-katalogen i containern (default: `/data`). Här ska `gravregister.db` och `källdata/` ligga. |
| `SESSION_SECRET_KEY` | Hemlig nyckel för session-cookies. **Sätt i produktion** (t.ex. lång slumpsträng). |
| `ADMIN_INITIAL_PASSWORD` | Valfritt: om databasen är tom skapas användaren `admin` med detta lösenord vid första start. |

## Exempel: docker run

```bash
docker run -d \
  --name gravregister \
  -p 8000:8000 \
  -v /sökväg/på/host/gravregister-data:/data \
  -e SESSION_SECRET_KEY="din-långa-hemliga-nyckel" \
  -e ADMIN_INITIAL_PASSWORD="tillfälligt-admin-lösenord" \
  gravregister
```

På hosten ska `/sökväg/på/host/gravregister-data` innehålla:

- `gravregister.db` (kan skapas tom eller kopieras från utveckling)
- `källdata/` med undermappar, t.ex. `källdata/01 HKG 01-09/` med PDF-filer

## Unraid

1. Bygg image eller använd Docker-templaten nedan.
2. Skapa en mapp för data (t.ex. `gravregister-data`) med underkatalogen `källdata` och eventuellt en befintlig `gravregister.db`.
3. Lägg till container med:
   - **Port:** 8000 → 8000 (eller annan hostport).
   - **Volume:** host-mappen `gravregister-data` → container-path `/data`.
   - **Env:** `SESSION_SECRET_KEY`, ev. `ADMIN_INITIAL_PASSWORD`.

Öppna sedan `http://<unraid-ip>:8000` i webbläsaren.

## Flytta befintlig databas

Du kan kopiera din nuvarande `gravregister.db` till data-volymen (samma mapp som `källdata/`). Ingen migration behövs – appen använder samma schema. Användare och inmatningar finns kvar.

**Sessioner:** Inloggning lagras i signerade cookies. Om du sätter **samma** `SESSION_SECRET_KEY` som du använde tidigare fortsätter befintliga sessioner att fungera. Sätter du en **ny** nyckel (rekommenderat i produktion) måste alla logga in igen; inget i databasen påverkas.

## .dockerignore

Projektet har redan en `.dockerignore` som exkluderar källdata, databas, .git m.m. för snabbare byggen.
