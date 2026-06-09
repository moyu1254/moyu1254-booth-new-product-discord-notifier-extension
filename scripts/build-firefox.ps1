param(
  [string]$OutputDir = "dist/firefox"
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..")).Path
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $repoRoot $OutputDir }
$rootManifestPath = Join-Path $repoRoot "manifest.json"
$firefoxManifestPath = Join-Path $repoRoot "manifests/firefox.json"

$rootManifest = Get-Content $rootManifestPath | ConvertFrom-Json
$firefoxManifest = Get-Content $firefoxManifestPath | ConvertFrom-Json
$firefoxManifest.version = $rootManifest.version

if (Test-Path $outputPath) {
  Remove-Item -LiteralPath $outputPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Copy-Item -Recurse -Path (Join-Path $repoRoot "src") -Destination (Join-Path $outputPath "src")
Copy-Item -Recurse -Path (Join-Path $repoRoot "icons") -Destination (Join-Path $outputPath "icons")
Copy-Item -Path (Join-Path $repoRoot "README.md") -Destination (Join-Path $outputPath "README.md")
$firefoxManifest | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $outputPath "manifest.json")

Write-Host "Firefox extension written to $outputPath"
