@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%3d-render-agent"

if not exist "%APP_DIR%\main.py" (
  echo [ERROR] Could not find "%APP_DIR%\main.py"
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
set "APP_PORT=7860"

set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

%PY% -c "import sys; sys.modules.setdefault('_wmi', None); import gradio" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Installing dependencies from requirements.txt ...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [INFO] Starting 3D Render Agent ...
%PY% main.py
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo [ERROR] App exited with code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%
