# URLBlast - Build Script
# Generates a store-ready .zip and a locally-installable .crx (unsigned)
# Usage: .\build.ps1

$ErrorActionPreference = "Stop"
$ExtName    = "URLBlast"
$ScriptDir  = $PSScriptRoot
$OutDir     = Join-Path $ScriptDir "dist"
$ZipOut     = Join-Path $OutDir "$ExtName.zip"

# Files/folders to EXCLUDE from the zip
$Exclude = @("dist", ".git", "*.ps1", "*.md", "*.png.bak", "node_modules", ".gemini", "implementation_plan.md", "task.md")

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  URLBlast Extension Build Script" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Validate manifest exists
$ManifestPath = Join-Path $ScriptDir "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "manifest.json not found in $ScriptDir"
    exit 1
}

# Read version from manifest
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Version  = $Manifest.version
Write-Host "  Building: $ExtName v$Version" -ForegroundColor White
Write-Host ""

# Create/clean dist directory
if (Test-Path $OutDir) {
    Remove-Item -Path $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# Collect files to include
$AllFiles = Get-ChildItem -Path $ScriptDir -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($ScriptDir.Length + 1)
    $excluded = $false
    foreach ($pattern in $Exclude) {
        if ($rel -like "$pattern*" -or $rel -like "*\$pattern\*" -or $_.Name -like $pattern) {
            $excluded = $true; break
        }
    }
    -not $excluded
}

Write-Host "  Files to include:" -ForegroundColor DarkGray
$AllFiles | ForEach-Object {
    Write-Host "    + $($_.FullName.Substring($ScriptDir.Length + 1))" -ForegroundColor DarkGray
}
Write-Host ""

# Stage files in system TEMP to avoid IDE file-lock issues
$TempStage = Join-Path $env:TEMP "URLBlast_build_$(Get-Random)"
New-Item -ItemType Directory -Path $TempStage -Force | Out-Null

foreach ($file in $AllFiles) {
    $rel     = $file.FullName.Substring($ScriptDir.Length + 1)
    $destFile = Join-Path $TempStage $rel
    $destDir  = Split-Path $destFile -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item -Path $file.FullName -Destination $destFile -Force
}

# Create zip using built-in cmdlet (PowerShell 5+)
Compress-Archive -Path "$TempStage\*" -DestinationPath $ZipOut -CompressionLevel Optimal -Force

# Clean up stage folder
Remove-Item -Path $TempStage -Recurse -Force

$ZipSize = [math]::Round((Get-Item $ZipOut).Length / 1KB, 1)

Write-Host "=================================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Output: $ZipOut" -ForegroundColor White
Write-Host "  Size:   $ZipSize KB" -ForegroundColor White
Write-Host "  Files:  $($AllFiles.Count)" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Test locally: chrome://extensions > Load Unpacked > select this folder" -ForegroundColor Yellow
Write-Host "  2. Publish to Chrome Web Store: https://chrome.google.com/webstore/devconsole" -ForegroundColor Yellow
Write-Host "  3. Publish to Edge Add-ons:     https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview" -ForegroundColor Yellow
Write-Host ""
