"""Konfiguration – sökvägar och inställningar."""
import os
from pathlib import Path

# Projektrot (en nivå ovanför app/). I Docker: sätt DATA_DIR till mountad volym (innehåller gravregister.db och källdata/)
_data_dir = os.environ.get("DATA_DIR")
if _data_dir and os.path.isabs(_data_dir):
    PROJECT_ROOT = Path(_data_dir)
else:
    PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Mapp med källdata – undermappar = PDF-arkiv per kyrkogård/gravkvarter
KÄLLDATA_DIR = PROJECT_ROOT / "källdata"

# Databasfil – om DATABASE_PATH sätts används den (absolut sökväg eller relativt PROJECT_ROOT)
# Ger möjlighet att ha t.ex. gravregister-dev.db i dev-container och gravregister.db i main:latest
_db_path = os.environ.get("DATABASE_PATH")
if _db_path:
    _p = Path(_db_path)
    DATABASE_PATH = _p if _p.is_absolute() else PROJECT_ROOT / _p
else:
    DATABASE_PATH = PROJECT_ROOT / "gravregister.db"

# Session (cookies) – använd stark hemlighet i produktion
SESSION_SECRET_KEY = os.environ.get("SESSION_SECRET_KEY", "dev-secret-byta-i-produktion")

# Första admin skapas vid start om inga användare finns (valfritt)
ADMIN_INITIAL_PASSWORD = os.environ.get("ADMIN_INITIAL_PASSWORD", "")

# Kyrkogårdar som visas i listan (grunddatahantering). Kommaseparerad lista, t.ex. KYRKOGARDAR=HKG,HKN,ÖVR
_kyrkogardar_str = os.environ.get("KYRKOGARDAR", "HKG,HKN")
KYRKOGARDAR = [k.strip() for k in _kyrkogardar_str.split(",") if k.strip()]

# Mapp för databas-säkerhetskopior (skapas vid behov; filer serveras via API för nedladdning)
BACKUP_DIR = PROJECT_ROOT / "säkerhetskopior"

# Fil för API-nycklar som sätts via admin-UI (alternativ till miljövariabler)
API_KEYS_PATH = PROJECT_ROOT / "api_keys.json"

