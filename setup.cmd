@echo off
REM ============================================================================
REM Midnight Fetcher Bot - Windows Setup Script
REM ============================================================================
REM This script performs complete setup:
REM 1. Checks/installs Node.js 20.x
REM 2. Verifies pre-built hash server executable exists
REM 3. Installs all dependencies
REM 4. Builds NextJS application
REM 5. Opens browser and starts the app
REM
REM NOTE: Rust toolchain is NOT required - using pre-built hash-server.exe
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo ================================================================================
echo                    Midnight Fetcher Bot - Setup
echo ================================================================================
echo.

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo WARNING: Running without administrator privileges.
    echo Some installations may require elevated permissions.
    echo.
    pause
)

REM ============================================================================
REM Check Node.js
REM ============================================================================
echo [1/6] Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Installing Node.js 20.x...
    echo.
    echo Please download and install Node.js 20.x from:
    echo https://nodejs.org/dist/v20.19.3/node-v20.19.3-x64.msi
    echo.
    echo After installation, run this script again.
    pause
    start https://nodejs.org/dist/v20.19.3/node-v20.19.3-x64.msi
    exit /b 1
) else (
    echo Node.js found!
    node --version
    echo.
)

REM ============================================================================
REM NOTE: Rust build steps are commented out - using pre-built hash-server.exe
REM ============================================================================
REM echo [2/6] Checking Rust installation...
REM where cargo >nul 2>&1
REM if %errorlevel% neq 0 (
REM     echo Rust not found. Installing Rust...
REM     echo.
REM     echo Downloading rustup-init.exe...
REM     powershell -Command "Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%TEMP%\rustup-init.exe'"
REM
REM     echo Running Rust installer...
REM     "%TEMP%\rustup-init.exe" -y --default-toolchain stable
REM
REM     REM Add Cargo to PATH for this session
REM     set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
REM
REM     echo Rust installed!
REM     echo.
REM     echo Verifying cargo is available...
REM     where cargo >nul 2>&1
REM     if %errorlevel% neq 0 (
REM         echo.
REM         echo ============================================================================
REM         echo IMPORTANT: Rust was installed but requires a shell restart.
REM         echo Please close this window and run setup.cmd again.
REM         echo ============================================================================
REM         echo.
REM         pause
REM         exit /b 1
REM     )
REM     cargo --version
REM     echo.
REM ) else (
REM     echo Rust found!
REM     cargo --version
REM     echo.
REM )

REM ============================================================================
REM Verify Hash Server Executable
REM ============================================================================
echo [2/6] Verifying hash server executable...
if not exist "hashengine\target\release\hash-server.exe" (
    echo.
    echo ============================================================================
    echo ERROR: Pre-built hash server executable not found!
    echo Expected location: hashengine\target\release\hash-server.exe
    echo.
    echo This file should be included in the repository.
    echo If you cloned the repo, ensure Git LFS is configured or re-clone.
    echo.
    echo If you want to build from source instead, you need to:
    echo   1. Install Rust from https://rustup.rs/
    echo   2. Run: cd hashengine ^&^& cargo build --release --bin hash-server
    echo ============================================================================
    echo.
    pause
    exit /b 1
)
echo Pre-built hash server found!
echo.

:install_deps

REM ============================================================================
REM Install dependencies
REM ============================================================================
echo [3/5] Installing project dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo Dependencies installed!
echo.

REM ============================================================================
REM Create required directories
REM ============================================================================
echo [4/5] Creating required directories...
if not exist "secure" mkdir secure
if not exist "storage" mkdir storage
if not exist "logs" mkdir logs
echo.

REM ============================================================================
REM Setup complete, start services
REM ============================================================================
echo ================================================================================
echo                         Setup Complete!
echo ================================================================================
echo.
echo [5/5] Starting services...
echo.

REM Start hash server in background
echo Starting hash server on port 9001...
set RUST_LOG=hash_server=info,actix_web=warn
set HOST=127.0.0.1
set PORT=9001
set WORKERS=12

start "Hash Server" /MIN hashengine\target\release\hash-server.exe
echo   - Hash server started (running in background window)
echo.

REM Wait for hash server to be ready
echo Waiting for hash server to initialize...
timeout /t 3 /nobreak >nul

:check_health
curl -s http://127.0.0.1:9001/health >nul 2>&1
if %errorlevel% neq 0 (
    echo   - Waiting for hash server...
    timeout /t 2 /nobreak >nul
    goto check_health
)
echo   - Hash server is ready!
echo.

echo ================================================================================
echo                    Midnight Fetcher Bot - Ready!
echo ================================================================================
echo.
echo Hash Service: http://127.0.0.1:9001/health
echo Web Interface: http://localhost:3000
echo.
echo The application will open in your default browser.
echo Press Ctrl+C to stop the Next.js server (hash server will continue running)
echo.
echo To stop hash server: taskkill /F /IM hash-server.exe
echo ================================================================================
echo.

REM Build production version
echo Building production version...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build production version
    pause
    exit /b 1
)
echo   - Production build complete!
echo.

REM Start NextJS production server in background
echo Starting Next.js production server...
start "Next.js Server" cmd /c "npm start"
echo   - Next.js server starting...
echo.

REM Wait for Next.js to be ready
echo Waiting for Next.js to initialize...
timeout /t 5 /nobreak >nul

echo   - Next.js server is ready!
echo.

REM Open browser to main app (not hash server)
echo Opening web interface...
start http://localhost:3001

echo.
echo ================================================================================
echo Both services are running!
echo Press any key to stop all services and exit...
echo ================================================================================
pause >nul

REM Stop both services
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM hash-server.exe >nul 2>&1

REM If we get here, the app stopped
echo.
echo Next.js server stopped.
echo Note: Hash server is still running. Use 'taskkill /F /IM hash-server.exe' to stop it.
pause
