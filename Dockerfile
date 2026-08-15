FROM python:3.13-slim

WORKDIR /app

# CBC solver for PuLP (installed from apt so both amd64 and arm64 have it;
# PuLP's bundled binary only covers x86_64).
RUN apt-get update \
    && apt-get install -y --no-install-recommends coinor-cbc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/cache \
    && chown -R app:app /app

USER app
ENV DATA_DIR=/app/data \
    CACHE_DIR=/app/cache \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
