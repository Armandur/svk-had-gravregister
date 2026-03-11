# Gravregister – digitalisering

Produktionsapplikation för digitalisering av skannade gravregister (HKG/HKN). Användaren bläddrar i PDF-källor, transkriberar gravrättsinnehavare och gravsatta, och hanterar extramaterial. All data lagras i en SQLite-databas.

- **Specifikation (datamodell, fält, specialfall):** [SPECIFICATION.md](SPECIFICATION.md)
- **Körning med Docker:** [DOCKER.md](DOCKER.md)
- **Användardokumentation:** [docs/](docs/) (samma texter kan visas i appen under Hjälp)

## Krav

- Python 3.11+
- PDF-källor under `källdata/` (en undermapp per arkiv; varje mapp = en sida PDF-filer, t.ex. 1.pdf, 2.pdf, …)

## Installation och körning

1. Skapa virtuell miljö och installera beroenden:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   # source .venv/bin/activate   # Linux/macOS
   pip install -r requirements.txt
   ```

2. Konfigurera miljö (valfritt): skapa `.env` eller sätt miljövariabler enligt `app/config.py` (t.ex. `DATA_DIR`, `DATABASE_PATH`, `SESSION_SECRET_KEY`).

3. Starta servern:

   ```bash
   uvicorn app.main:app --reload
   ```

4. Öppna http://127.0.0.1:8000 i webbläsaren. Logga in (standard användare `admin` skapas vid första start om `ADMIN_INITIAL_PASSWORD` är satt).

## Övrigt

- **Docker:** Se [DOCKER.md](DOCKER.md) för bygg, volymer och miljövariabler.
- **Hjälp i appen:** Under **Hjälp** på startsidan kan du öppna samma dokumentation som i denna mapp (docs/ och specifikation).
