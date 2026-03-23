# CLAUDE.md – Gravregister-projektet

Guider Claude Code när du arbetar med det här projektet.

## Projektöversikt

Webbapplikation för digitalisering av skannade gravregisterkort från svenska kyrkogårdar (primärt Härnösands kyrkogård – HKG och HKN). Användare bläddrar i PDF-skanningar, transkriberar gravar och kan använda Claude AI för automatisk OCR-extraktion.

## Arkitektur

| Lager | Teknik |
|-------|--------|
| Backend | FastAPI (Python, async) |
| Databas | SQLite via SQLAlchemy ORM (sync session, aiosqlite driver) |
| Frontend | Vanilla JS + HTML + CSS (ingen frontend-bundler) |
| AI | Anthropic Claude API (Messages + Batch API) |
| PDF-rendering | PyMuPDF (fitz) |
| Auth | bcrypt-lösenord, Starlette SessionMiddleware (signed cookie) |

## Köra lokalt

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
# Öppna http://localhost:8000
# Lägg källdata-PDFer i källdata/<mappnamn>/
```

Sätt miljövariabler (eller skapa `.env`-fil och ladda manuellt):
```
DATA_DIR=/sökväg/till/datadir      # standard: projektrot
SESSION_SECRET_KEY=hemlig-nyckel
ADMIN_INITIAL_PASSWORD=admin123    # skapas bara om inga användare finns
ANTHROPIC_API_KEY=sk-ant-...       # kan också sättas via admin-UI
```

Alternativt med Docker: se `DOCKER.md`.

## Nyckelkonventioner

### Python / Backend
- **Asynkron kod**: FastAPI-rutter är `async def`. SQLAlchemy-sessionen är *synkron* (`Session`, inte `AsyncSession`) men körs via `get_db()` dependency-injection.
- **Route-filer** i `app/routes/` – en fil per domänområde. Importeras i `app/main.py`.
- **Privata hjälpfunktioner** namnges med `_`-prefix även om de används av flera moduler (befintlig konvention – ändra inte utan god anledning).
- **Databas-init**: Tabeller skapas i `app/database.py::init_db()`. Migrationer hanteras inte med Alembic – nya kolumner läggs till med `ALTER TABLE`-guards i `init_db()`.
- **Modeller** i `app/database.py` (SQLAlchemy ORM), **scheman** (request/response) i `app/schemas.py` (Pydantic).

### JavaScript / Frontend
- Ingen bundler – filer laddas direkt via `<script>`-taggar i HTML.
- Modulstruktur: `gravplatser.js` är huvudmodulen för gravplatsvyn; den importeras av `gravplatser-ocr.js`, `gravplatser-sok.js`, m.fl. via globalt state-objekt `window.GravplatsApp`.
- **utils.js** har gemensamma hjälpare: `escapeHtml()`, `showToast()`, `apiFetch()`.
- `apiFetch()` i utils.js hanterar fetch + felhantering konsekvent – använd den i stället för `fetch()` direkt.

### Databas-schema (kort)
Se `app/database.py` för fullständiga modeller. Viktigaste tabeller:

| Tabell | Beskrivning |
|--------|-------------|
| `user` | Användarkonton |
| `mapp_config` | En rad per PDF-mapp (kyrkogård + gravkvarter) |
| `gravplats` | Registrerad gravplats (pekare till sida + segment i mapp) |
| `gravplats_inmatning` | Transkriberad data för en gravplats |
| `gravplats_innehavare` | Gravrätti(n)na (1–n per gravplats) |
| `gravsatt` | Begravda (max 10 per gravplats) |
| `claude_anropslogg` | Logg över Claude-API-anrop (tokens + kostnad) |
| `claude_ocr_svar` | Senaste Claude OCR-svar per gravplats |
| `claude_batch_jobb` | Batch-jobb |

### Claude OCR-integration
- **Spec-fil**: `app/prompts/gravregister_spec.md` – detta är system-promoten som skickas till Claude. Redigera den för att påverka OCR-beteende.
- **OCR-service**: `app/services/ocr_service.py` – bygger request, skickar bilder, returnerar JSON.
- **Endpoint**: `POST /api/ocr/gravplats/{id}` → `app/routes/ocr.py`
- **Batch**: `app/routes/batch.py`, använder Anthropic Batch API (50 % rabatt, upp till 24 h svarstid).
- **Prompt caching** används för spec-texten (ephemeral cache) → ~90 % besparing på spec-tokens.
- **Modell**: `claude-sonnet-4-6` (hårdkodat i `app/services/ocr_service.py::MODEL`).

## Fil- och mappstruktur

```
app/
  main.py           FastAPI app, middleware, router-registrering
  config.py         Sökvägar + env-variabel-läsning
  database.py       SQLAlchemy ORM-modeller + init_db()
  schemas.py        Pydantic request/response-scheman
  auth.py           Lösenordshash, session, get_current_user
  constants.py      App-konstanter (cache-headers, batch-tröskel)
  routes/           En fil per domänområde (auth, admin, mappar, gravplatser, ocr, batch, …)
  services/
    ocr_service.py  Claude API-klient
  utils/
    api_keys.py     Läs/skriv api_keys.json + env-override
    pdf_utils.py    PDF-listning, rendering-hjälpare
    gravplats_utils.py  Beräkna "halvor" per gravplats
    achievements.py Achievement-logik
    git_version.py  Läs git-versionstagg
  prompts/
    gravregister_spec.md  System-prompt för Claude OCR (nuvarande version)

static/
  app.js            PDF-bläddraren + sidhantering
  gravplatser.js    Huvudmodul för gravplatsvyn (state, formulär, navigering)
  gravplatser-ocr.js  Claude OCR UI-logik
  gravplatser-sok.js  Sökfunktionalitet
  gravplatser-historik.js  Redigeringshistorik
  gravplatser-rapport.js  Rapport-modal
  gravplatser-lightbox.js  Zoom/pan-bildvisare
  index.js          Startsida (statistik, snabbnavigering)
  utils.js          Gemensamma hjälpare (apiFetch, showToast, escapeHtml)
  style.css         Gemensam CSS
  gravplatser.css   CSS specifik för gravplatsvyn
  *.html            Sidmallar (laddas direkt i browser)

docs/               Användardokumentation (markdown)
```

## Vanliga uppgifter

### Lägga till ett nytt API-endpoint
1. Lägg till rutten i lämplig fil under `app/routes/` (eller skapa ny fil).
2. Om ny fil: importera och registrera routern i `app/main.py`.
3. Lägg till eventuella Pydantic-scheman i `app/schemas.py`.
4. Testa via `/docs` (FastAPI Swagger UI).

### Ändra databasschema
1. Lägg till/ändra kolumn i modellen i `app/database.py`.
2. Lägg till en `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`-sats i `init_db()` (SQLite stöder inte `IF NOT EXISTS` nativt – kontrollera mot `pragma_table_info` om nödvändigt).
3. Starta om appen – `init_db()` kör `CREATE TABLE IF NOT EXISTS` + migrations.

### Uppdatera Claude OCR-prompten
Redigera `app/prompts/gravregister_spec.md`. Observera att cachen invalideras när texten ändras (100 % input-tokens faktureras för nästa anrop, sedan cachelagras igen).

### Frontend-ändringar
Redigera HTML/JS/CSS direkt i `static/`. Ingen byggesteg krävs. Ladda om sidan i webbläsaren (evt. hard-refresh för att rensa webbläsarens cache).

## Kända begränsningar / teknisk skuld

- **Inga automatiserade tester** – all testning är manuell. Prioritet att lägga till `pytest`-tester för åtminstone routes och OCR-service.
- **`@app.on_event("startup")` är deprecated** i FastAPI ≥ 0.93 – bör bytas till `lifespan` context manager.
- **`api_keys.py`-funktioner läser JSON från disk vid varje anrop** – inget cachningslager.
- **Synkron SQLAlchemy-session i async context** – fungerar men är inte optimalt; full migrering till `AsyncSession` är möjlig men kräver större refaktorering.
- Se `docs/improvements-backlog.md` för fler kända förbättringsförslag.
