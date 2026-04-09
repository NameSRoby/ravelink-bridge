param(
  [string]$Version = "1.6.2"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $root "dist"
$stageRoot = Join-Path $distRoot "RaveLink-Bridge-v$Version"
$zipPath = Join-Path $distRoot "RaveLink-Bridge-v$Version.zip"
$buildId = if ($env:RAVELINK_RELEASE_BUILD_ID) { "$($env:RAVELINK_RELEASE_BUILD_ID)".Trim() } else { "build-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" }

function Reset-Path([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Copy-ItemSafe([string]$Source, [string]$Destination) {
  if (!(Test-Path -LiteralPath $Source)) {
    throw "Missing required release path: $Source"
  }
  $parent = Split-Path -Parent $Destination
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
Reset-Path $stageRoot
Reset-Path $zipPath
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$includePaths = @(
  "src",
  "public",
  "scripts",
  "docs\repo-documentation",
  "node_modules",
  "package.json",
  "package-lock.json",
  "RELEASE_BUILD.json",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "RaveLink-Bridge-Start.bat",
  "RaveLink-Bridge-Stop.bat",
  "RaveLink-Bridge-Install-Optional-Audio-Tools.bat"
)

foreach ($relativePath in $includePaths) {
  $source = Join-Path $root $relativePath
  $destination = Join-Path $stageRoot $relativePath
  Copy-ItemSafe $source $destination
}

$releaseBuild = [ordered]@{
  version = "$Version"
  buildId = "$buildId"
  channel = "release"
  releaseTag = "v$Version"
  source = "packaged-release"
}
$releaseBuildPath = Join-Path $stageRoot "RELEASE_BUILD.json"
$releaseBuild | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $releaseBuildPath -Encoding UTF8

$modsDir = Join-Path $stageRoot "mods"
New-Item -ItemType Directory -Force -Path $modsDir | Out-Null
@'
No mods are bundled in this release.

Place optional local mods inside this folder after install.
The current song-request mod is intentionally excluded from the public repository and packaged release.
'@ | Set-Content -LiteralPath (Join-Path $modsDir "README.txt") -Encoding UTF8

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "[PACKAGE] Created $zipPath"
