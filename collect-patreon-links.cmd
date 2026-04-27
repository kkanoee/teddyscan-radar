@echo off
setlocal

cd /d "%~dp0"

set /p PATREON_URL=URL Patreon: 
if "%PATREON_URL%"=="" (
  echo URL manquante.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-patreon-links.ps1" -Url "%PATREON_URL%" -ManualLogin -UseChrome

echo.
pause
