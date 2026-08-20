@echo off
setlocal
title Blockcraft - Multiplayer

cd /d "%~dp0"

echo.
echo   Blockcraft - Multiplayer
echo   ------------------------
echo   (For single player only, run start-singleplayer.bat instead.)
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js is not installed or not on your PATH.
    echo   Get it from https://nodejs.org  then run this file again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo   First run - installing dependencies. This takes a minute...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   Install failed. Check the messages above.
        pause
        exit /b 1
    )
    echo.
)

echo   Starting the game server and opening your browser...
echo   Leave this window open while you play. Close it to stop the game.
echo.

REM Give the dev server a head start before the browser opens. `ping` is used
REM as the delay because `timeout` needs a real console and fails when this
REM script is launched from another tool.
start "" /b cmd /c "ping -n 6 127.0.0.1 >nul && start "" http://localhost:5173"

call npm run dev

echo.
echo   Blockcraft stopped.
pause
