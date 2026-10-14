@echo off
setlocal
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

if not exist "node_modules" (
    echo Dependencies are missing. Run install.bat first.
    pause
    exit /b 1
)

if not exist ".env" (
    echo Configuration is missing. Run install.bat first.
    pause
    exit /b 1
)

npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo The run failed. Check the message above and the logs folder.
pause
exit /b %EXIT_CODE%
