@echo off
title Nova Casino - Bot
cd /d "%~dp0"
echo ============================================
echo    Iniciando Nova Casino Bot...
echo    (deja esta ventana abierta mientras juegues)
echo    Para apagarlo: cierra la ventana o pulsa Ctrl+C
echo ============================================
echo.
call npm start
echo.
echo ============================================
echo    El bot se ha detenido.
echo ============================================
pause
