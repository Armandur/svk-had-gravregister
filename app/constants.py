"""Applikationsövergripande konstanter."""

# Cache-huvud för genererade bilder (1 timme; webbläsaren kan cacha)
CACHE_HEADERS = {"Cache-Control": "private, max-age=3600"}

# Gräns: jobb med färre gravar än detta körs som realtid (Messages API),
# övriga skickas till Anthropics asynkrona Batch API (50 % rabatt, upp till 24 h).
ANTHROPIC_BATCH_GRANS = 100
