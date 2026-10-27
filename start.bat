@echo off
rem Gen 3 Map Blueprint - double-click to start (Windows).
rem The first run installs the tool's parts into this folder (node_modules);
rem nothing is installed anywhere else on your computer.

cd /d "%~dp0"
title Gen 3 Map Blueprint

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed, so the tool can't start.
  echo  Install the "LTS" version from https://nodejs.org , then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo  First run: installing the tool's parts into this folder. This takes a minute...
  echo.
  call npm ci --no-audit
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection, then try again.
    echo  If it keeps failing, copy the messages above and ask for help.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Starting Gen 3 Map Blueprint. Your browser will open in a moment.
echo  Keep this window open while you work. Close it to stop the tool.
echo.
call npm run dev -- --open
if errorlevel 1 (
  echo.
  echo  The tool stopped with an error. Copy the messages above if you need help.
  pause
)
