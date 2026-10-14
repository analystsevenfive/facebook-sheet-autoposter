param(
    [string]$ServiceAccountKey
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    return $null
}

function Sync-PathFromRegistry {
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Install-WithWinget($id, $friendlyName) {
    if (-not (Test-CommandExists 'winget')) {
        Write-Host "winget is not available on this machine, so $friendlyName can't be installed automatically." -ForegroundColor Yellow
        return $false
    }
    Write-Host "$friendlyName not found - installing via winget (this may show a Windows admin permission prompt)..." -ForegroundColor Yellow
    winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent
    Sync-PathFromRegistry
    return $true
}

Write-Host "== Facebook Sheet Autoposter setup ==" -ForegroundColor Cyan

if (-not (Test-CommandExists 'node')) {
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js' | Out-Null
}
if (-not (Test-CommandExists 'node')) {
    throw "Node.js not found (auto-install failed or unavailable). Install Node.js 20+ from https://nodejs.org/, then re-run this script."
}
$nodeVersion = (node --version) -replace '^v', ''
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 20) {
    throw "Node.js $nodeVersion found, but 20+ is required. Update Node.js and re-run this script."
}
Write-Host "Node.js $nodeVersion OK"

if (-not (Find-Chrome)) {
    Install-WithWinget 'Google.Chrome' 'Google Chrome' | Out-Null
}
if (Find-Chrome) {
    Write-Host "Google Chrome OK"
} else {
    Write-Host "Google Chrome still not found - install it from https://www.google.com/chrome/ before logging in to Facebook." -ForegroundColor Yellow
}

Set-Location -LiteralPath $projectRoot

Write-Host "`nInstalling npm dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed. Check your network connection, then run install.bat again." }

foreach ($dir in @('secrets', 'data', 'logs')) {
    $path = Join-Path $projectRoot $dir
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "Created $dir\"
    }
}

$envPath = Join-Path $projectRoot '.env'
$envExamplePath = Join-Path $projectRoot '.env.example'
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $envExamplePath -Destination $envPath
    Write-Host "Created .env from .env.example (PUBLISH_ENABLED=false by default)"
} else {
    Write-Host ".env already exists, left untouched"
}

$accountsPath = Join-Path $projectRoot 'accounts.json'
$accountsExamplePath = Join-Path $projectRoot 'accounts.example.json'
if (-not (Test-Path -LiteralPath $accountsPath)) {
    Copy-Item -LiteralPath $accountsExamplePath -Destination $accountsPath
    Write-Host "Created accounts.json from accounts.example.json - edit it for this machine's Facebook accounts"
} else {
    Write-Host "accounts.json already exists, left untouched"
}

$serviceAccountPath = Join-Path $projectRoot 'secrets\google-service-account.json'
$haveServiceAccountKey = Test-Path -LiteralPath $serviceAccountPath
if ($ServiceAccountKey) {
    if (-not (Test-Path -LiteralPath $ServiceAccountKey)) { throw "ServiceAccountKey file not found: $ServiceAccountKey" }
    Copy-Item -LiteralPath $ServiceAccountKey -Destination $serviceAccountPath -Force
    Write-Host "Copied service account key to secrets\google-service-account.json"
    $haveServiceAccountKey = $true
} elseif ($haveServiceAccountKey) {
    Write-Host "secrets\google-service-account.json already present, left untouched"
}

Write-Host "`n== Setup finished. Remaining steps (must be done by hand on this machine): ==" -ForegroundColor Cyan
Write-Host "Double-click run.bat any time to start the poster. Check PUBLISH_ENABLED in .env before the first run."
if ($haveServiceAccountKey) {
    Write-Host "1. Edit accounts.json to match this machine's Facebook accounts"
    Write-Host '2. Run: npm run login:facebook -- "<Facebook display name>" for each account'
    Write-Host "3. Run: npm run check:facebook  (confirms every account is signed in and ready)"
    Write-Host "4. Run: npm test"
    Write-Host "5. Run: npm run dry-run"
    Write-Host "6. Only after reviewing dry-run output, set PUBLISH_ENABLED=true in .env"
    Write-Host "7. Run: powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1"
} else {
    Write-Host "1. Get secrets\google-service-account.json from whoever manages the Google Cloud project" -ForegroundColor Yellow
    Write-Host "   (or re-run this script with -ServiceAccountKey <path to the downloaded json>)" -ForegroundColor Yellow
    Write-Host "   The service account's email must be shared as Editor on the Google Sheet." -ForegroundColor Yellow
    Write-Host "2. Edit accounts.json to match this machine's Facebook accounts"
    Write-Host '3. Run: npm run login:facebook -- "<Facebook display name>" for each account'
    Write-Host "4. Run: npm run check:facebook  (confirms every account is signed in and ready)"
    Write-Host "5. Run: npm test"
    Write-Host "6. Run: npm run dry-run"
    Write-Host "7. Only after reviewing dry-run output, set PUBLISH_ENABLED=true in .env"
    Write-Host "8. Run: powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1"
}
