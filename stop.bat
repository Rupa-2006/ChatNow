@echo off
rem Double-click to stop ChatNow's backend and website.
rem Use "stop.bat all" to also stop the PostgreSQL and Redis containers.
if /i "%~1"=="all" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" -All
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
)
