$ErrorActionPreference = 'Stop'
$jevRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $jevRoot
$jevRuntime = Join-Path $jevRoot '.runtime'
New-Item -ItemType Directory -Force -Path $jevRuntime | Out-Null
$jevVersion = 'v0.34.2'
$jevArchive = Join-Path $jevRuntime 'ollama.zip'
$jevExe = Join-Path $jevRuntime 'ollama/ollama.exe'
if (-not (Test-Path -LiteralPath $jevExe)) {
  if ((-not (Test-Path -LiteralPath $jevArchive)) -or (Get-Item -LiteralPath $jevArchive).Length -lt 1460928014) {
    Write-Host 'Downloading portable Ollama (approximately 1.46 GB)...'
    curl.exe -L --fail --show-error --retry 5 --retry-all-errors -C - "https://github.com/ollama/ollama/releases/download/$jevVersion/ollama-windows-amd64.zip" -o $jevArchive
    if ($LASTEXITCODE -ne 0) { throw 'Download interrupted. Run setup:local again to resume.' }
  }
  $jevChecksums = (Invoke-WebRequest -UseBasicParsing "https://github.com/ollama/ollama/releases/download/$jevVersion/sha256sum.txt").Content
  if ($jevChecksums -is [byte[]]) { $jevChecksums = [System.Text.Encoding]::UTF8.GetString($jevChecksums) }
  $jevLine = ($jevChecksums -split "`n" | Where-Object { $_ -match '\s\*?(\./)?ollama-windows-amd64\.zip\s*$' })
  if (-not $jevLine) { throw 'Release checksum not found.' }
  $jevExpected = ($jevLine.Trim() -split '\s+')[0]
  $jevSha = [System.Security.Cryptography.SHA256]::Create()
  $jevStream = [System.IO.File]::OpenRead($jevArchive)
  try { $jevActual = [BitConverter]::ToString($jevSha.ComputeHash($jevStream)).Replace('-', '').ToLowerInvariant() }
  finally { $jevStream.Dispose(); $jevSha.Dispose() }
  if ($jevActual -ne $jevExpected) { throw 'Checksum mismatch. Remove .runtime/ollama.zip and retry.' }
  Write-Host 'Extracting verified Ollama release...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($jevArchive, (Join-Path $jevRuntime 'ollama'))
}
& (Join-Path $PSScriptRoot 'start-model.ps1')
$env:OLLAMA_HOST = '127.0.0.1:11435'
& $jevExe pull qwen2.5:3b
if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }
Write-Host 'Local model ready. Run npm start, then open http://127.0.0.1:15413'
