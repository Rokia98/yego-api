#!/bin/bash

# 🚀 Script de démarrage rapide pour Yègo API

set -e  # Exit on error

echo "═══════════════════════════════════════════════════════════════"
echo "  🚌 Yègo API - Script de démarrage rapide"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Vérifier Node.js
echo "✓ Vérification de Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé"
    exit 1
fi
echo "  Node: $(node -v)"
echo "  npm: $(npm -v)"
echo ""

# Vérifier PostgreSQL
echo "✓ Vérification de PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL CLI n'est pas trouvé (mais peut être installé)"
else
    echo "  PostgreSQL: OK"
fi
echo ""

# Étape 1: Installer les dépendances
echo "📦 Étape 1: Installation des dépendances..."
if [ ! -d "node_modules" ]; then
    npm install
    echo "  ✅ Dépendances installées"
else
    echo "  ✅ node_modules existe déjà"
fi
echo ""

# Étape 2: Vérifier la configuration
echo "⚙️  Étape 2: Configuration..."
if [ ! -f ".env" ]; then
    echo "  ⚠️  Fichier .env non trouvé"
    echo "  Création de .env depuis .env.example..."
    cp .env.example .env
    echo "  ⚠️  IMPORTANT: Éditer .env et remplir DATABASE_URL avant de continuer"
    echo ""
    echo "  Appuyez sur ENTER après avoir édité .env..."
    read
else
    echo "  ✅ Fichier .env trouvé"
fi
echo ""

# Étape 3: Setup Prisma
echo "🗄️  Étape 3: Setup base de données..."
echo "  Génération du client Prisma..."
npm run prisma:generate

echo "  Migration de la base de données..."
npm run prisma:migrate

echo "  ✅ Base de données prête"
echo ""

# Étape 4: Optionnel - Seed
read -p "🌱 Voulez-vous charger les données d'exemple? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Chargement des données d'exemple..."
    npm run prisma:seed
    echo "✅ Données d'exemple chargées"
fi
echo ""

# Étape 5: Démarrage
echo "═══════════════════════════════════════════════════════════════"
echo "🎉 Configuration terminée!"
echo ""
echo "Pour démarrer le serveur, exécutez:"
echo "  npm run start:dev"
echo ""
echo "L'API sera disponible sur: http://localhost:3000/api/v1"
echo ""
echo "📚 Documentation: voir README.md"
echo "🧪 Tests: importer yego-api.postman_collection.json dans Postman"
echo "═══════════════════════════════════════════════════════════════"
