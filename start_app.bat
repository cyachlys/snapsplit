@echo off
title SplitWoi!
cd /d "%~dp0"

echo.
echo  =========================================================
echo    SplitWoi! - Starting server + public online link...
echo  =========================================================
echo.

:: Check if the server is already running on port 3000
powershell -Command "try { (New-Object Net.Sockets.TcpClient('localhost',3000)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if "%ERRORLEVEL%"=="0" (
    echo  [Server] Already running on port 3000.
) else (
    echo  [Server] Starting Node.js server...
    start "SplitWoi Server" /min cmd /c "node --no-warnings server.js"
    timeout /t 2 >nul
    echo  [Server] Started! http://localhost:3000
)

:: Open the browser on this machine
start "" "http://localhost:3000"
echo  [Browser] Opened http://localhost:3000
echo.

echo  =========================================================
echo    GETTING PUBLIC LINK (works on any Wi-Fi, any device)
echo  =========================================================
echo.
echo  Connecting... this takes about 5 seconds.
echo  Your link will appear below. Copy it and send to anyone!
echo.
echo  To STOP sharing, just close this window.
echo.

:: Use Windows built-in SSH to open a free tunnel via pinggy.io
:: No npm, no PowerShell, no installs, no admin rights needed
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R 80:localhost:3000 a.pinggy.io

pause
