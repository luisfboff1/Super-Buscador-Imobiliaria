FROM node:22-slim

# Playwright precisa dessas dependências do sistema
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json e instalar dependências
COPY package.json package-lock.json* ./
RUN npm ci

# Instalar browser Chromium do Playwright
RUN npx playwright install chromium

# Copiar código e buildar
COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
