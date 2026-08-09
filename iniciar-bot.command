#!/bin/bash
# Lanzador del bot Nova Casino para macOS.
# Doble clic para: instalar dependencias, registrar comandos y arrancar el bot.

cd "$(dirname "$0")"

echo "========================================"
echo "   NOVA CASINO - Bot de Discord (Mac)"
echo "========================================"
echo ""

# 1) Comprobar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no esta instalado."
  echo "Instalalo desde https://nodejs.org (elige la version LTS),"
  echo "reinicia el Mac o cierra y abre este archivo, y vuelve a intentarlo."
  echo ""
  read -n 1 -s -r -p "Pulsa una tecla para cerrar..."
  exit 1
fi
echo "[OK] Node.js detectado: $(node -v)"
echo ""

# 2) Comprobar el archivo .env (con tu token)
if [ ! -f ".env" ]; then
  echo "[AVISO] Falta el archivo .env con tu token."
  if [ -f ".env.example" ]; then
    cp ".env.example" ".env"
    echo ""
    echo "He creado un archivo llamado  .env"
    echo "1) Abrelo con TextEdit (clic derecho -> Abrir con -> TextEdit)."
    echo "2) Pon tu DISCORD_TOKEN (el largo, de la pagina 'Bot') y tu CLIENT_ID."
    echo "3) Guarda y vuelve a abrir este iniciar-bot.command."
  else
    echo "Crea un archivo .env con: DISCORD_TOKEN=tu_token  y  CLIENT_ID=tu_id"
  fi
  echo ""
  read -n 1 -s -r -p "Pulsa una tecla para cerrar..."
  exit 1
fi

# 3) Instalar dependencias
echo "[1/3] Instalando dependencias (npm install)..."
npm install || { echo "[ERROR] Fallo en npm install."; read -n 1 -s -r -p "Pulsa una tecla para cerrar..."; exit 1; }
echo ""

# 4) Registrar los comandos slash en Discord
echo "[2/3] Registrando comandos en Discord (npm run deploy)..."
npm run deploy
echo ""

# 5) Arrancar el bot
echo "[3/3] Arrancando el bot... (deja esta ventana ABIERTA mientras juegas)"
echo "      Para apagarlo: cierra la ventana o pulsa Ctrl + C"
echo ""
npm start

echo ""
echo "El bot se ha detenido."
read -n 1 -s -r -p "Pulsa una tecla para cerrar..."
