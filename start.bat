@echo off
rem Double-click to start ChatNow. The real work (checks, setup, start-up) is in
rem scripts\start.ps1; this file only runs it, bypassing PowerShell's script policy
rem for this one script.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
