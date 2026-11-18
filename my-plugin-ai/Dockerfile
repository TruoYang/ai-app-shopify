# Production image for Render (or any Docker host): Node app + Python trainer + Postgres.
# Build:   docker build -t smartcart-rcm .
# Runtime env: DATABASE_URL (Postgres), SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES,
#              SHOPIFY_APP_URL (or RENDER_EXTERNAL_URL, set by Render). See docs/DEPLOY.md.

# ---- Build stage: all dependencies, Prisma client for Postgres, app bundle ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY extensions/smartcart-discount/package.json extensions/smartcart-discount/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate --schema prisma/postgres/schema.prisma && npx react-router build

# ---- Runtime stage ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    ML_PYTHON=/opt/venv/bin/python \
    PORT=3000
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
# Python trainer without PyTorch (DEC / Hybrid fall back to the built-in Apriori on this server).
COPY ml/requirements-server.txt ml/
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r ml/requirements-server.txt
COPY package.json package-lock.json ./
COPY extensions/smartcart-discount/package.json extensions/smartcart-discount/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY prisma ./prisma
COPY ml ./ml
COPY --from=build /app/build ./build
RUN npx prisma generate --schema prisma/postgres/schema.prisma
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
