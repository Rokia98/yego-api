#!/bin/sh
set -e

# Applique les migrations Prisma en attente avant de démarrer l'API.
# Idempotent : ne fait rien si la base est déjà à jour.
echo "→ Application des migrations Prisma..."
npx prisma migrate deploy

# Seed optionnel : SEED_ON_START=true (à réserver au premier démarrage / dev).
if [ "$SEED_ON_START" = "true" ] && [ -f dist/prisma/seed.js ]; then
  echo "→ Seed de la base..."
  node dist/prisma/seed.js || echo "⚠️  Seed ignoré ou déjà appliqué."
fi

echo "→ Démarrage de l'API."
exec "$@"
