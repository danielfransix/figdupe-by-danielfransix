
@echo off
cd /d "%~dp0"

if not exist "server\node_modules\ws" (
    echo Installing dependencies...
    cd server
    npm install
    cd ..
)

echo Starting figdupe server...
node server\server.js
pause
