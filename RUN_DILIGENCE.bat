@echo off
setlocal EnableDelayedExpansion
title Legal M and A Due Diligence Scanner
color 0A
echo ======================================================================
echo      LEGAL M^&A AUTOMATION: CONTRACT SCANNER (MULTI-DEAL PIPELINE)
echo ======================================================================
echo.

:: Default values
set "DEAL=Project Titan Acquisition"
set "TARGET=Target Technologies Corp."
set "CONTRACTS="

echo Configure Transaction Details (Press ENTER to accept default):
echo ----------------------------------------------------------------------
set /p "USER_DEAL=Enter Deal/Project Name   [!DEAL!]: "
if not "!USER_DEAL!"=="" set "DEAL=!USER_DEAL!"

set /p "USER_TARGET=Enter Target Company     [!TARGET!]: "
if not "!USER_TARGET!"=="" set "TARGET=!USER_TARGET!"

set /p "USER_CONTRACTS=Contracts Folder (Optional) [Auto-detect]: "
if not "!USER_CONTRACTS!"=="" set "CONTRACTS=!USER_CONTRACTS!"

echo.
echo ======================================================================
echo Active Audit Parameters:
echo   Transaction : !DEAL!
echo   Target      : !TARGET!
if not "!CONTRACTS!"=="" (
  echo   Data Room   : !CONTRACTS!
) else (
  echo   Data Room   : contracts/ (Auto-detecting project folder)
)
echo ======================================================================
echo.

:: Detect Node.js runtime
set NODE_EXE=node
where node >nul 2>nul
if %errorlevel% neq 0 (
  if exist "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" (
    set "NODE_EXE=C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe"
  ) else if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    set "NODE_EXE=%APPDATA%\Antigravity\bin\agy-node.cmd"
  )
)

if not "!CONTRACTS!"=="" (
  "%NODE_EXE%" "%~dp0run_prototype.js" --deal="!DEAL!" --target="!TARGET!" --contracts="!CONTRACTS!" --open
) else (
  "%NODE_EXE%" "%~dp0run_prototype.js" --deal="!DEAL!" --target="!TARGET!" --open
)

echo.
pause
