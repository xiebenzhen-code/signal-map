$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDir = Join-Path $projectRoot "dist"
$packageDir = Join-Path $projectRoot "dist-edgeone-drop"
$zipPath = Join-Path $projectRoot "cyber-rx-dist.zip"
$indexHtml = Join-Path $distDir "index.html"

if (!(Test-Path $indexHtml)) {
  throw "dist/index.html does not exist. Run npm run build:edgeone first."
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $packageDir | Out-Null
Copy-Item -LiteralPath (Join-Path $distDir "index.html") -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $distDir "_next") -Destination $packageDir -Recurse -Force

foreach ($fileName in @("_headers", "favicon.svg", "og.png")) {
  $path = Join-Path $distDir $fileName
  if (Test-Path $path) {
    Copy-Item -LiteralPath $path -Destination $packageDir -Force
  }
}

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

$entries = tar.exe -tf $zipPath
if ($entries -notcontains "index.html") {
  throw "Invalid ZIP: index.html is not at the ZIP root."
}
if ($entries -contains "dist/index.html") {
  throw "Invalid ZIP: dist folder should not be at the ZIP root."
}

Write-Output $zipPath
