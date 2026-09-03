@echo off
REM 🚀 Script de démarrage rapide pour Yègo API (Windows)

setlocal enabledelayedexpansion

echo.
echo =====================================================================
echo   🚌 Yego API - Script de demarrage rapide (Windows)
echo =====================================================================
echo.

REM Vérifier Node.js
echo Verification de Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ❌ Node.js n'est pas installe
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo   Node: %NODE_VERSION%
echo   npm: %NPM_VERSION%
echo.

REM Étape 1: Installer les dépendances
echo 📦 Etape 1: Installation des dependances...
if not exist "node_modules" (
    echo   Installation...
    call npm install
    echo   ✅ Dependances installees
) else (
    echo   ✅ node_modules existe deja
)
echo.

REM Étape 2: Vérifier la configuration
echo ⚙️  Etape 2: Configuration...
if not exist ".env" (
    echo   ⚠️  Fichier .env non trouve
    echo   Creation de .env depuis .env.example...
    if exist ".env.example" (
        type .env.example > .env
        echo   ✅ Fichier .env cree
    ) else (
        echo   ❌ Fichier .env.example non trouve
        exit /b 1
    )
    echo.
    echo   ⚠️  IMPORTANT: Editer .env et remplir DATABASE_URL
    pause
) else (
    echo   ✅ Fichier .env trouve
)
echo.

REM Étape 3: Setup Prisma
echo 🗄️  Etape 3: Setup base de donnees...
echo   Generation du client Prisma...
call npm run prisma:generate

echo   Migration de la base de donnees...
call npm run prisma:migrate

echo   ✅ Base de donnees prete
echo.

REM Étape 4: Optionnel - Seed
set /p SEED="🌱 Voulez-vous charger les donnees d'exemple? (o/n) "
if /i "%SEED%"=="o" (
    echo Chargement des donnees d'exemple...
    call npm run prisma:seed
    echo ✅ Donnees d'exemple chargees
)
echo.

REM Étape 5: Summary
echo =====================================================================
echo 🎉 Configuration terminee!
echo.
echo Pour demarrer le serveur, executez:
echo   npm run start:dev
echo.
echo L'API sera disponible sur: http://localhost:3000/api/v1
echo.
echo 📚 Documentation: voir README.md
echo 🧪 Tests: importer yego-api.postman_collection.json dans Postman
echo =====================================================================
pause
