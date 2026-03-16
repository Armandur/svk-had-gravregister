"""Applikationsövergripande konstanter."""

# Cache-huvud för genererade bilder (1 timme; webbläsaren kan cacha)
CACHE_HEADERS = {"Cache-Control": "private, max-age=3600"}

# Priser för claude-sonnet-4-6 (USD per miljon tokens)
_CLAUDE_PRIS = {"input": 3.00, "output": 15.00, "cache_creation": 3.75, "cache_read": 0.30}

# Gräns: jobb med färre gravar än detta körs som realtid (Messages API),
# övriga skickas till Anthropics asynkrona Batch API (50 % rabatt, upp till 24 h).
ANTHROPIC_BATCH_GRANS = 100
