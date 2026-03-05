"""Konfiguration – sökvägar och inställningar."""
from pathlib import Path

# Projektrot (en nivå ovanför app/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Mapp med källdata – undermappar = PDF-arkiv per kyrkogård/gravkvarter
KÄLLDATA_DIR = PROJECT_ROOT / "källdata"
