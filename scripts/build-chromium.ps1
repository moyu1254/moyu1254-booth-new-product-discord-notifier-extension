param(
  [string]$OutputDir = "dist/chromium"
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..")).Path
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $repoRoot $OutputDir }

if (Test-Path $outputPath) {
  Remove-Item -LiteralPath $outputPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Copy-Item -Recurse -Path (Join-Path $repoRoot "src") -Destination (Join-Path $outputPath "src")
Copy-Item -Recurse -Path (Join-Path $repoRoot "icons") -Destination (Join-Path $outputPath "icons")
Copy-Item -Path (Join-Path $repoRoot ".gitignore") -Destination (Join-Path $outputPath ".gitignore")
Copy-Item -Path (Join-Path $repoRoot "README.md") -Destination (Join-Path $outputPath "README.md")
Copy-Item -Path (Join-Path $repoRoot "manifest.json") -Destination (Join-Path $outputPath "manifest.json")

Write-Host "Chromium extension written to $outputPath"
