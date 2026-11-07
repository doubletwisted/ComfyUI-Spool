@echo off
rem Start the Spool studio without ComfyUI and open it in the browser.
rem Extra arguments go to "python -m spool", for example: run_spool.bat --port 8191
setlocal
cd /d "%~dp0"
rem The portable build's Python ignores user site-packages, as ComfyUI's own launchers do.
set "PY=%~dp0..\..\..\python_embeded\python.exe"
set "FLAGS=-s"
if exist "%PY%" goto run
set "FLAGS="
set "PY=%~dp0..\..\venv\Scripts\python.exe"
if exist "%PY%" goto run
set "PY=%~dp0..\..\.venv\Scripts\python.exe"
if exist "%PY%" goto run
set "PY=python"
:run
rem The portable build's python_embeded has a ._pth file, so Python leaves this folder
rem off sys.path and "-m spool" alone cannot find Spool; add it before running.
"%PY%" %FLAGS% -c "import runpy, sys; sys.path.insert(0, '.'); runpy.run_module('spool', run_name='__main__', alter_sys=True)" --open %*
if errorlevel 1 pause
