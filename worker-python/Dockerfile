# ─── Stage 1: Build + Install deps ───────────────────────────────────────────
FROM python:3.12-slim AS builder

# Dependências de sistema para psycopg2 e lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ─── Stage 2: Runtime com browsers ───────────────────────────────────────────
FROM python:3.12-slim

# Dependências de sistema para Playwright/Scrapling browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libxml2 \
    libxslt1.1 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libwayland-client0 \
    fonts-liberation \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar dependências instaladas do builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Instalar browsers do Scrapling (Chromium via Playwright + camoufox)
RUN scrapling install

# Copiar código
COPY . .

# Health check para Railway
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001

# Iniciar servidor
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3001} --log-level warning"]
