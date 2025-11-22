@echo off
REM ============================================================================
REM Fetcher Bot - Quick Start (After Initial Setup)
REM ============================================================================
REM This script starts the hash server and Next.js dev server
REM Run setup.cmd first if this is your first time!
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo ================================================================================
echo                    Fetcher Bot - Starting...
echo ================================================================================
echo.

REM Check if hash server binary exists
if not exist "hashengine\target\release\hash-server.exe" (
    echo ERROR: Hash server not built yet!
    echo Please run setup.cmd first to build everything.
    pause
    exit /b 1
)

REM Start hash server
echo [1/3] Starting hash server on port 9001...
set RUST_LOG=hash_server=info,actix_web=warn
set HOST=127.0.0.1
set PORT=9001

REM Auto-detect CPU cores for optimal hash server workers
REM Use NUMBER_OF_PROCESSORS environment variable (set by Windows)
set WORKERS=%NUMBER_OF_PROCESSORS%
if not defined WORKERS set WORKERS=8

echo   - Using %WORKERS% hash server workers (detected %NUMBER_OF_PROCESSORS% CPU cores)

start "Hash Server" /MIN hashengine\target\release\hash-server.exe
echo   - Hash server started (minimized window)
echo.

REM Wait for hash server
echo [2/3] Waiting for hash server to be ready...
timeout /t 3 /nobreak >nul

:check_health
curl -s http://127.0.0.1:9001/health >nul 2>&1
if %errorlevel% neq 0 (
    echo   - Waiting...
    timeout /t 2 /nobreak >nul
    goto check_health
)
echo   - Hash server ready!
echo.

REM Start Next.js
echo [3/3] Starting Next.js development server...
echo.
echo ================================================================================
echo                         Ready to Mine!
echo ================================================================================
echo.
echo Hash Service: http://127.0.0.1:9001/health
echo Web Interface: http://localhost:3001
echo.
echo Press Ctrl+C to stop Next.js (hash server continues in background)
echo To stop hash server: taskkill /F /IM hash-server.exe
echo ================================================================================
echo.

REM Start dev server in background first
start "Next.js Dev Server" cmd /c "npx next dev -p 3001"
echo   - Next.js dev server starting...
echo.

REM Wait for Next.js to be ready
echo Waiting for Next.js to compile and start...
timeout /t 5 /nobreak >nul

:check_nextjs
curl -s http://localhost:3001/api/profiles >nul 2>&1
if %errorlevel% neq 0 (
    echo   - Compiling... (this may take a moment on first run)
    timeout /t 3 /nobreak >nul
    goto check_nextjs
)
echo   - Next.js server is ready!
echo.

REM Refresh mining profiles from remote server
echo Fetching latest mining profiles...
curl -s -X POST http://localhost:3001/api/profiles/refresh >nul 2>&1
if %errorlevel% equ 0 (
    echo   - Mining profiles updated from remote server
) else (
    echo   - Could not fetch remote profiles (will use local profiles)
)
echo.

REM Open browser
start http://localhost:3001

echo.
echo ================================================================================
echo                         Mining Application Running
echo ================================================================================
echo.
echo Press any key to stop all services and exit...
pause >nul

REM Stop services
taskkill /F /IM node.exe >nul 2>&1

echo.
echo Next.js stopped.
echo Hash server still running. Use 'taskkill /F /IM hash-server.exe' to stop it.
pause
