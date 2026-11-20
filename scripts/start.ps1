# ChatNow one-click launcher (Windows). Run via start.bat, or:
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#
# Every step checks before acting, so running it again is always safe:
#   1. Node.js and Docker are installed
#   2. .env files exist (created with fresh random secrets on first run)
#   3. Docker Desktop is running (started and waited for if not)
#   4. PostgreSQL and Redis containers are up and healthy
#   5. npm packages are installed
#   6. Database tables are up to date (Prisma migrations)
#   7. Ports 4000 and 5174 are free (old ChatNow servers are stopped)
#   8. Backend and frontend start in their own windows
#   9. Both answer, then the browser opens

# 'Continue', not 'Stop': in Windows PowerShell 5.1, Docker and npm write normal
# progress to stderr, which 'Stop' would turn into a fatal error. Every step checks
# $LASTEXITCODE or its result explicitly instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot

# True if a process belongs to this project. Node records some paths with forward
# slashes (C:/Projects/...), so compare in one form.
function Test-OwnProcess($proc) {
  $proc -and $proc.CommandLine -and (($proc.CommandLine -replace '/', '\') -match [regex]::Escape($Root))
}
Set-Location $Root
$Host.UI.RawUI.WindowTitle = 'ChatNow launcher'

function Step($n, $text) { Write-Host "`n[$n/9] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "      OK  $text" -ForegroundColor Green }
function Info($text) { Write-Host "      ..  $text" -ForegroundColor Gray }
function Fail($text) {
  Write-Host "`n  PROBLEM: $text" -ForegroundColor Red
  Write-Host '  Fix the problem above, then double-click start.bat again.' -ForegroundColor Yellow
  Read-Host '  Press Enter to close'
  exit 1
}
function Wait-Until([scriptblock]$Check, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Check) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}
function Test-Url($url) {
  try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
function New-Secret($bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Write-Utf8NoBom($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '               Starting ChatNow' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

# 1 ---------------------------------------------------------------------------
Step 1 'Checking required software'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org' }
Ok "Node.js $(node --version)"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker Desktop is not installed. See "Prerequisites" in README.md.' }
Ok 'Docker is installed'

# 2 ---------------------------------------------------------------------------
Step 2 'Checking settings files (.env)'
if (-not (Test-Path '.env')) {
  $text = (Get-Content '.env.example' -Raw) -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$(New-Secret 24)"
  Write-Utf8NoBom (Join-Path $Root '.env') $text
  Info 'Created .env with a new random database password'
}
$pgPassword = ((Get-Content '.env') -match '^POSTGRES_PASSWORD=' | Select-Object -First 1) -replace '^POSTGRES_PASSWORD=', ''
if (-not $pgPassword) { Fail 'POSTGRES_PASSWORD is empty in .env' }
if (-not (Test-Path 'backend\.env')) {
  $text = Get-Content 'backend\.env.example' -Raw
  $text = $text.Replace('REPLACE_WITH_POSTGRES_PASSWORD', $pgPassword)
  $text = $text -replace '(?m)^JWT_ACCESS_SECRET=.*$', "JWT_ACCESS_SECRET=$(New-Secret 48)"
  $text = $text -replace '(?m)^SEED_USER_PASSWORD=.*$', "SEED_USER_PASSWORD=$(New-Secret 12)"
  Write-Utf8NoBom (Join-Path $Root 'backend\.env') $text
  Info 'Created backend\.env with new random secrets'
}
Ok 'Settings files present'

# 3 ---------------------------------------------------------------------------
Step 3 'Checking Docker Desktop'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $exe)) { Fail 'Docker Desktop is not running and could not be found. Start it from the Start menu.' }
  Info 'Starting Docker Desktop (this can take a minute)...'
  Start-Process $exe
  $up = Wait-Until { docker info *> $null; $LASTEXITCODE -eq 0 } 180
  if (-not $up) { Fail 'Docker Desktop did not finish starting. Open it, wait for "Engine running", then try again.' }
}
Ok 'Docker engine is running'

# 4 ---------------------------------------------------------------------------
Step 4 'Starting the database (PostgreSQL) and Redis'
docker compose up -d postgres redis 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the database containers. Run "docker compose up -d postgres redis" to see the error.' }
$healthy = Wait-Until {
  $pg = docker inspect -f '{{.State.Health.Status}}' chatnow-postgres-1 2>$null
  $rd = docker inspect -f '{{.State.Health.Status}}' chatnow-redis-1 2>$null
  $pg -eq 'healthy' -and $rd -eq 'healthy'
} 90
if (-not $healthy) { Fail 'PostgreSQL or Redis did not become healthy. Run "docker compose ps" to check.' }
Ok 'PostgreSQL and Redis are healthy'

# 5 ---------------------------------------------------------------------------
Step 5 'Checking npm packages'
foreach ($app in 'backend', 'frontend') {
  $marker = if ($app -eq 'backend') { 'node_modules\tsx\package.json' } else { 'node_modules\vite\package.json' }
  if (-not (Test-Path (Join-Path $app $marker))) {
    Info "Installing $app packages (first run only, a few minutes)..."
    Push-Location $app
    npm install --no-fund --no-audit --loglevel=error
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "npm install failed in $app." }
  }
  Ok "$app packages installed"
}

# 6 ---------------------------------------------------------------------------
Step 6 'Updating the database tables'
Push-Location backend
if (-not (Test-Path 'node_modules\.prisma\client\index.js')) { npx prisma generate 2>&1 | Out-Null }
$migrate = npx prisma migrate deploy 2>&1 | Out-String
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Write-Host $migrate; Fail 'Database migration failed (output above).' }
Ok 'Database is up to date'

# 7 ---------------------------------------------------------------------------
Step 7 'Freeing ports 4000 (backend) and 5174 (website)'
# Close windows left by an earlier start, with everything under them (npm, the tsx
# file-watcher, the servers), so no stray watcher can relaunch an old server.
$old = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'title ChatNow (Backend|Frontend)' }
foreach ($w in $old) { & taskkill /PID $w.ProcessId /T /F *> $null }
if ($old) { Info "Closed $(@($old).Count) window(s) from an earlier start"; Start-Sleep -Seconds 1 }
# Then anything of ours still on a port (for example started without this launcher).
foreach ($port in 4000, 5174) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { continue }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  if (Test-OwnProcess $proc) {
    Info "Stopping an older ChatNow server on port $port"
    & taskkill /PID $conn.OwningProcess /T /F *> $null
    Start-Sleep -Seconds 1
  } else {
    Fail "Port $port is used by another program ($($proc.Name), PID $($conn.OwningProcess)). Close it and try again."
  }
}
Ok 'Ports are free'

# 8 ---------------------------------------------------------------------------
Step 8 'Starting the backend and the website'
Start-Process cmd -ArgumentList '/k', "title ChatNow Backend && cd /d `"$Root\backend`" && npm run dev" -WindowStyle Minimized
Start-Process cmd -ArgumentList '/k', "title ChatNow Frontend && cd /d `"$Root\frontend`" && npm run dev" -WindowStyle Minimized
Ok 'Started (two minimized windows: ChatNow Backend, ChatNow Frontend)'

# 9 ---------------------------------------------------------------------------
Step 9 'Waiting for ChatNow to answer'
if (-not (Wait-Until { Test-Url 'http://localhost:4000/api/health' } 90)) { Fail 'The backend did not start. Open the "ChatNow Backend" window to see the error.' }
Ok 'Backend is ready'
if (-not (Wait-Until { Test-Url 'http://localhost:5174/' } 60)) { Fail 'The website did not start. Open the "ChatNow Frontend" window to see the error.' }
Ok 'Website is ready'

Start-Process 'http://localhost:5174'

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host '   ChatNow is running:  http://localhost:5174' -ForegroundColor Green
Write-Host '==================================================' -ForegroundColor Green
Write-Host '   Two users: open a second window with Ctrl+Shift+N (Incognito).'
Write-Host '   To stop:   double-click stop.bat'
Write-Host '   Keep the two minimized ChatNow windows open while you use the app.'
Write-Host ''
Read-Host 'Press Enter to close this launcher window (ChatNow keeps running)'
