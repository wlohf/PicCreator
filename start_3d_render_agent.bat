@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%3d-render-agent"
set "UI_DIR=%APP_DIR%\ui-prototype"

if not exist "%APP_DIR%\api_server.py" (
  echo [ERROR] Could not find "%APP_DIR%\api_server.py"
  pause
  exit /b 1
)

if not exist "%UI_DIR%\package.json" (
  echo [ERROR] Could not find "%UI_DIR%\package.json"
  pause
  exit /b 1
)

cd /d "%APP_DIR%"

if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" (
      if /i not "%%A:~0,1%%"=="#" set "%%A=%%B"
    )
  )
)

set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"
if not defined APP_HOST set "APP_HOST=127.0.0.1"
if not defined APP_PORT set "APP_PORT=8787"
if not defined VITE_PORT set "VITE_PORT=42958"
set "VITE_API_TARGET=http://127.0.0.1:%APP_PORT%"

set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

%PY% -c "import fastapi, uvicorn, multipart" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Installing dependencies from requirements.txt ...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js first, then run this script again.
  pause
  exit /b 1
)

cd /d "%UI_DIR%"
if not exist "node_modules\.bin\vite.cmd" (
  echo [INFO] Installing or repairing frontend dependencies ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Frontend dependency installation failed.
    pause
    exit /b 1
  )
)
if not exist "node_modules\.bin\vite.cmd" (
  echo [ERROR] Vite was not installed. Try deleting "%UI_DIR%\node_modules" and running this script again.
  pause
  exit /b 1
)

echo [INFO] Starting PicCreate split app ...
echo [INFO] API: http://127.0.0.1:%APP_PORT%/api/health
echo [INFO] Web: http://127.0.0.1:%VITE_PORT%/

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$port=[int]$env:APP_PORT;" ^
  "$owners=@(Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "if($owners.Count -gt 0){" ^
  "  $healthOk=$false;" ^
  "  try { $health=Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 2; $healthOk=($health.service -eq '3d-render-agent-api') } catch {}" ^
  "  $own=@(); $foreign=@();" ^
  "  foreach($owner in $owners){" ^
  "    $proc=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $owner);" ^
  "    $cmd=[string]$proc.CommandLine;" ^
  "    if($healthOk -and $cmd -match 'api_server\.py') { $own += $owner } else { $foreign += ('PID ' + $owner + ': ' + $cmd) }" ^
  "  }" ^
  "  if($foreign.Count -gt 0) { Write-Host ('[ERROR] API port ' + $port + ' is used by ' + ($foreign -join '; ')); exit 2 }" ^
  "  foreach($owner in $own) { Stop-Process -Id $owner -Force }" ^
  "  Start-Sleep -Milliseconds 800;" ^
  "  Write-Host ('[INFO] Stopped ' + $own.Count + ' old PicCreate API process(es) on port ' + $port + '.'); exit 0" ^
  "}"
if errorlevel 2 (
  echo [ERROR] Please free API port %APP_PORT% or set APP_PORT to another port.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$port=[int]$env:VITE_PORT;" ^
  "$owners=@(Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "if($owners.Count -gt 0){" ^
  "  $uiPath=[Regex]::Escape((Resolve-Path $env:UI_DIR).Path);" ^
  "  $own=@(); $foreign=@();" ^
  "  foreach($owner in $owners){" ^
  "    $proc=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $owner);" ^
  "    $cmd=[string]$proc.CommandLine;" ^
  "    if($cmd -match $uiPath -and $cmd -match 'vite') { $own += $owner } else { $foreign += ('PID ' + $owner + ': ' + $cmd) }" ^
  "  }" ^
  "  if($foreign.Count -gt 0) { Write-Host ('[ERROR] Web port ' + $port + ' is used by ' + ($foreign -join '; ')); exit 2 }" ^
  "  foreach($owner in $own) { Stop-Process -Id $owner -Force }" ^
  "  Start-Sleep -Milliseconds 800;" ^
  "  Write-Host ('[INFO] Stopped ' + $own.Count + ' old PicCreate Web process(es) on port ' + $port + '.'); exit 0" ^
  "}"
if errorlevel 2 (
  echo [ERROR] Please free Web port %VITE_PORT% or set VITE_PORT to another port.
  pause
  exit /b 1
)

start "PicCreate API" cmd /k "cd /d ""%APP_DIR%"" && set APP_HOST=%APP_HOST%&& set APP_PORT=%APP_PORT%&& ""%PY%"" api_server.py"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$port=[int]$env:APP_PORT;" ^
  "$ok=$false;" ^
  "for($i=0; $i -lt 60; $i++){" ^
  "  try {" ^
  "    $health=Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 2;" ^
  "    if($health.service -eq '3d-render-agent-api') { $ok=$true; break }" ^
  "  } catch {}" ^
  "  Start-Sleep -Seconds 1" ^
  "}" ^
  "if($ok) { Write-Host ('[INFO] API is ready on http://127.0.0.1:' + $port + '/api/health'); exit 0 }" ^
  "Write-Host ('[ERROR] API did not become ready on http://127.0.0.1:' + $port + '/api/health within 60 seconds. Check the PicCreate API window for errors.'); exit 1"
if errorlevel 1 (
  pause
  exit /b 1
)

start "PicCreate Web" cmd /k "cd /d ""%UI_DIR%"" && set VITE_PORT=%VITE_PORT%&& set VITE_API_TARGET=%VITE_API_TARGET%&& npm run dev -- --host 0.0.0.0 --port %VITE_PORT% --strictPort"
echo [INFO] Keep the terminal window(s) running while using the app.
echo [INFO] Open http://127.0.0.1:%VITE_PORT%/ in your browser.
pause
exit /b 0
