# syntax=docker/dockerfile:1
# Destination Mystère — image de production (Next.js standalone + Prisma).
#
#   docker build -t destination-mystere .
#   (voir docker-compose.yml pour le lancement complet : db + app + cron)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma/Next au build : URL factice (les routes API sont dynamiques, rien
# n'est pré-rendu contre la base).
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# --chmod=644 : le logo public/ doit être lisible par l'user non-root « nextjs ».
COPY --chmod=0644 --from=builder /app/public ./public
# Prisma : client généré + moteurs (non tracés par le standalone Next).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Données lues au runtime (le reste de data/ est monté en volume, voir compose).
COPY --chmod=0644 --from=builder /app/data/fixtures ./data/fixtures
COPY --chmod=0644 --from=builder /app/data/airports ./data/airports
RUN mkdir -p /app/data/logs && chown -R nextjs:nextjs /app
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/challenge >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
