@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo Build failed.
  exit /b 1
)
echo Build OK. dist folder ready for Vercel.
exit /b 0
