param(
  [string]$OutputDir = "dist/firefox"
)

$ErrorActionPreference = "Stop"

if (Test-Path $OutputDir) {
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Copy-Item -Recurse -Path "src" -Destination (Join-Path $OutputDir "src")
Copy-Item -Recurse -Path "icons" -Destination (Join-Path $OutputDir "icons")
Copy-Item -Path "README.md" -Destination (Join-Path $OutputDir "README.md")
Copy-Item -Path "manifests/firefox.json" -Destination (Join-Path $OutputDir "manifest.json")

Write-Host "Firefox extension written to $OutputDir"
