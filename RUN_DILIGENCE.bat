@echo off
title Legal M and A Due Diligence Scanner
color 0A
echo ======================================================================
echo      LEGAL M^&A AUTOMATION: CONTRACT SCANNER (PDF & TXT PIPELINE)
echo ======================================================================
echo.
echo Scanning contracts (.pdf / .txt) in the 'contracts' folder...
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

"%NODE_EXE%" "%~dp0run_prototype.js"

echo.
echo ======================================================================
echo Launching generated PDF report and visual dashboard...
echo ======================================================================
if exist "%~dp0reports\due_diligence_report.pdf" (
  start "" "%~dp0reports\due_diligence_report.pdf"
)
if exist "%~dp0reports\due_diligence_dashboard.html" (
  start "" "%~dp0reports\due_diligence_dashboard.html"
)
echo.
pause
