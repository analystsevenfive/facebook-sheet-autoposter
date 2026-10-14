param(
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'facebook-sheet-autoposter.zip')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$stagePath = Join-Path ([System.IO.Path]::GetTempPath()) ("facebook-sheet-autoposter-" + [guid]::NewGuid().ToString('N'))
$stageProjectPath = Join-Path $stagePath 'facebook-sheet-autoposter'

try {
    New-Item -ItemType Directory -Path $stageProjectPath -Force | Out-Null
    $include = @(
        'src', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'INSTALL.md',
        'install.bat', 'run.bat', '.env', '.env.example', 'accounts.example.json', '.gitignore'
    )
    foreach ($item in $include) {
        $source = Join-Path $projectRoot $item
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination $stageProjectPath -Recurse -Force
        }
    }

    $outputDirectory = Split-Path -Parent $outputFullPath
    if (-not (Test-Path -LiteralPath $outputDirectory)) {
        New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    }
    if (Test-Path -LiteralPath $outputFullPath) {
        Remove-Item -LiteralPath $outputFullPath -Force
    }
    Compress-Archive -Path (Join-Path $stageProjectPath '*') -DestinationPath $outputFullPath -CompressionLevel Optimal
    Write-Host "Created clean installer package: $outputFullPath" -ForegroundColor Green
    Write-Host 'Included .env settings; excluded account data, browser sessions, logs, dependencies, and secret keys.'
} finally {
    if (Test-Path -LiteralPath $stagePath) {
        Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
}
