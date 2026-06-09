param(
  [string]$PackageDir = "dist/packages"
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..")).Path
$packagePath = if ([System.IO.Path]::IsPathRooted($PackageDir)) { $PackageDir } else { Join-Path $repoRoot $PackageDir }
$rootManifestPath = Join-Path $repoRoot "manifest.json"

$rootManifest = Get-Content $rootManifestPath | ConvertFrom-Json
$version = $rootManifest.version

& (Join-Path $scriptRoot "build-chromium.ps1")
& (Join-Path $scriptRoot "build-firefox.ps1")

if (Test-Path $packagePath) {
  Remove-Item -LiteralPath $packagePath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packagePath | Out-Null

$chromiumZip = Join-Path $packagePath "booth-new-product-discord-notifier-extension-chromium-v$version.zip"
$firefoxZip = Join-Path $packagePath "booth-new-product-discord-notifier-extension-firefox-v$version.zip"

Compress-Archive -Path (Join-Path $repoRoot "dist/chromium/*") -DestinationPath $chromiumZip -Force
Compress-Archive -Path (Join-Path $repoRoot "dist/firefox/*") -DestinationPath $firefoxZip -Force

Write-Host "Release packages written to $packagePath"
