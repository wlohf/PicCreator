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
set "APP_HOST=127.0.0.1"
set "APP_PORT=8787"
set "VITE_PORT=5174"
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
if not exist "node_modules" (
  echo [INFO] Installing frontend dependencies ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Frontend dependency installation failed.
    pause
    exit /b 1
  )
)

echo [INFO] Starting PicCreate split app ...
echo [INFO] API: http://127.0.0.1:%APP_PORT%/api/health
echo [INFO] Web: http://127.0.0.1:%VITE_PORT%/
start "PicCreate API" cmd /k "cd /d ""%APP_DIR%"" && set APP_HOST=%APP_HOST%&& set APP_PORT=%APP_PORT%&& ""%PY%"" api_server.py"
start "PicCreate Web" cmd /k "cd /d ""%UI_DIR%"" && set VITE_PORT=%VITE_PORT%&& set VITE_API_TARGET=%VITE_API_TARGET%&& npm run dev"
echo [INFO] Two terminal windows were opened. Keep them running while using the app.
echo [INFO] Open http://127.0.0.1:%VITE_PORT%/ in your browser.
pause
exit /b 0
