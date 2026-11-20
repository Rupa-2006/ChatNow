# Stops the ChatNow backend and website started by start.bat.
# PostgreSQL and Redis keep running in Docker (they use little memory and keep your
# data); pass -All to stop them as well.
param([switch]$All)

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host 'Stopping ChatNow...' -ForegroundColor Cyan

$stopped = 0
# Each ChatNow window was started by start.ps1 as "cmd /k title ChatNow Backend && ...".
# Ending that window's whole process tree (/T) also ends npm, the tsx file-watcher and
# the server under it; stopping only the process on the port would leave the watcher,
# which can relaunch the server later.
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object { $_.CommandLine -match 'title ChatNow (Backend|Frontend)' } |
  ForEach-Object { & taskkill /PID $_.ProcessId /T /F *> $null; $stopped++ }

# Fallback: anything of ours still holding a port (e.g. started some other way).
foreach ($port in 4000, 5174) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { continue }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  # Only ever stop ChatNow's own servers, never another program using the port.
  # Node records some paths with forward slashes, so compare in one form.
  if ($proc -and $proc.CommandLine -and (($proc.CommandLine -replace '/', '\') -match [regex]::Escape($Root))) {
    & taskkill /PID $conn.OwningProcess /T /F *> $null
    $stopped++
  }
}
Write-Host "  Stopped ($stopped window/server process trees)." -ForegroundColor Green

if ($All) {
  docker compose stop postgres redis 2>&1 | Out-Null
  Write-Host '  Stopped PostgreSQL and Redis (your data is kept).' -ForegroundColor Green
} else {
  Write-Host '  PostgreSQL and Redis are still running in Docker (data kept).' -ForegroundColor Gray
}
Start-Sleep -Seconds 2
