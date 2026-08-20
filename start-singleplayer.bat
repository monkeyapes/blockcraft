@echo off
setlocal
title Blockcraft - Single Player

cd /d "%~dp0"

echo.
echo   Blockcraft - Single Player
echo   --------------------------
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

echo   Starting the game and opening your browser...
echo   Leave this window open while you play. Close it to stop the game.
echo.

REM No multiplayer server here: single player runs the world in the browser
REM and saves it locally. `ping` is the delay because `timeout` needs a real
REM console and fails when this script is launched from another tool.
start "" /b cmd /c "ping -n 6 127.0.0.1 >nul && start "" http://localhost:5173"

call npm run dev:client

echo.
echo   Blockcraft stopped.
pause
