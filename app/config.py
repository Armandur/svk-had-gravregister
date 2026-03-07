"""Konfiguration – sökvägar och inställningar."""
import os
from pathlib import Path

# Projektrot (en nivå ovanför app/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Mapp med källdata – undermappar = PDF-arkiv per kyrkogård/gravkvarter
KÄLLDATA_DIR = PROJECT_ROOT / "källdata"

# Session (cookies) – använd stark hemlighet i produktion
SESSION_SECRET_KEY = os.environ.get("SESSION_SECRET_KEY", "dev-secret-byta-i-produktion")

# Första admin skapas vid start om inga användare finns (valfritt)
ADMIN_INITIAL_PASSWORD = os.environ.get("ADMIN_INITIAL_PASSWORD", "")
