# Gravregister – digitalisering

Digitalisering av skannade gravregister (HKG/HKN). Se [SPECIFICATION.md](SPECIFICATION.md) för fullständig specifikation.

## PoC (proof of concept)

### Förberedelser

1. Skapa virtuell miljö och installera beroenden:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

2. Lägg dina PDF-mappar under `källdata/` (t.ex. `källdata/mapp_1/`, `källdata/mapp_2/`). Varje mapp = en sida PDF-filer (1.pdf, 2.pdf, …).

### Köra PoC

```bash
uvicorn app.main:app --reload
```

Öppna http://127.0.0.1:8000 i webbläsaren. Välj mapp, ange kyrkogård och gravkvarter, och bläddra mellan gravplatser (3 PDF-sidor visas åt gången).
