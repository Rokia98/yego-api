# syntax=docker/dockerfile:1

###############################################################################
# Étape 1 — build : dépendances complètes, génération Prisma, compilation TS  #
###############################################################################
FROM node:22-alpine AS builder
WORKDIR /app

# python3/make/g++ : compilation de bcrypt (module natif).
# openssl : requis par le moteur Prisma.
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Compile aussi le script de seed en JS pur (pas de ts-node au runtime).
RUN npx tsc prisma/seed.ts --outDir dist/prisma --module commonjs \
      --target ES2021 --esModuleInterop --skipLibCheck --moduleResolution node

# Élague vers les dépendances de production uniquement (client Prisma inclus).
RUN npm prune --omit=dev

###############################################################################
# Étape 2 — runtime : image minimale, utilisateur non-root                    #
###############################################################################
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# tini : gestion des signaux (PID 1). openssl + libc6-compat : moteur Prisma.
RUN apk add --no-cache tini openssl libc6-compat

# --chown : les fichiers appartiennent à l'utilisateur non privilégié 'node',
# pour que 'prisma migrate deploy' puisse écrire ses fichiers temporaires.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Dossier des documents uploadés (monté en volume, voir docker-compose.yml) :
# créé avec les droits du user non-root AVANT le premier montage, pour que
# Docker copie ces permissions dans le volume vide.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
