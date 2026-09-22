$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules/ajv')) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$jevUseBundled = $true
if (Test-Path -LiteralPath '.env') {
  if (Get-Content -LiteralPath '.env' | Where-Object { $_ -eq 'INFERENCE_BACKEND=vllm' }) { $jevUseBundled = $false; Write-Host 'vLLM backend selected. Start it separately with npm run model:vllm.' }
  $jevUrlLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^OLLAMA_URL=' } | Select-Object -Last 1
  if ($jevUrlLine -and $jevUrlLine -ne 'OLLAMA_URL=http://127.0.0.1:11435') { $jevUseBundled = $false }
}
if ($jevUseBundled) {
  & (Join-Path $PSScriptRoot 'scripts/start-model.ps1')
}
& npm.cmd start
