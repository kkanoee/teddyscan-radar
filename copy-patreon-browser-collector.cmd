@echo off
setlocal

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '.\scripts\patreon-browser-collector.js' -Raw | Set-Clipboard"

echo Collecteur copie dans le presse-papiers.
echo.
echo Ouvre Patreon dans TON Chrome normal, connecte avec Google.
echo Puis F12 ^> Console ^> colle le script ^> Entree.
echo.
pause
