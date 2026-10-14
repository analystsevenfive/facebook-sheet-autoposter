@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "KEY_FILE=%SCRIPT_DIR%google-service-account.json"

echo ============================================
echo  Facebook Sheet Autoposter - Installer
echo ============================================
echo.

where powershell >nul 2>nul
if errorlevel 1 (
    echo Windows PowerShell was not found. This installer requires Windows 10 or newer.
    pause
    exit /b 1
)

if exist "%KEY_FILE%" (
    echo Found google-service-account.json next to this installer - using it.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\setup.ps1" -ServiceAccountKey "%KEY_FILE%"
) else (
    echo No google-service-account.json found next to this installer.
    echo You can drop the key file here and re-run this installer, or add it later.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\setup.ps1"
)
if errorlevel 1 (
    echo.
    echo Setup failed. Read the error above, fix it, then run install.bat again.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Setup finished. See the steps printed above.
echo ============================================
pause
