# Gravregister – Docker image för Unraid/t.ex. produktionskörning
# Bygg: docker build -t gravregister .
# Kör: se DOCKER.md eller exempel nedan

FROM python:3.11-slim

WORKDIR /app

# Systempaket för PyMuPDF (fitz)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    mupdf-tools \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY static/ ./static/

# Volym för data: sätt DATA_DIR=/data och mounta katalog med gravregister.db och källdata/
ENV DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
