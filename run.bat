@echo off
setlocal

if "%~1"=="" (
    echo Usage:
    echo   Drag a .zip or .rar archive onto this file, or run from cmd:
    echo     run.bat ^<archive^> [more archives...]
    echo.
    pause
    exit /b 1
)

set "SCRIPT=%~dp0extract_sessions.py"

:loop
if "%~1"=="" goto end
echo.
echo === Processing: %~1 ===
python "%SCRIPT%" "%~1"
if errorlevel 1 echo [!] Exit code: %errorlevel%
shift
goto loop

:end
echo.
echo All done. Press any key to close...
pause >nul
