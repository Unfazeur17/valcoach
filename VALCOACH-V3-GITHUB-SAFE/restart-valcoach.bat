@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

if not exist ".env" copy ".env.example" ".env" >nul

where node >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:3000"
  node server.js
  pause
  exit /b
)

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
  start "" "http://localhost:3000"
  "%CODEX_NODE%" server.js
  pause
  exit /b
)

echo Node.js est introuvable.
echo Installe Node.js depuis https://nodejs.org ou lance depuis Codex Desktop.
pause
