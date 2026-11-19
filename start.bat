@echo off
echo ===================================================
echo Starting ChatNow Messaging Platform...
echo ===================================================

start "ChatNow Backend" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul
start "ChatNow Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 2 /nobreak >nul
start http://localhost:5174

echo Servers started!
echo Frontend: http://localhost:5174
echo Backend:  http://localhost:4000
