param([switch]$Safe)
$ErrorActionPreference = 'Stop'
$jevRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$jevEnvPath = Join-Path $jevRoot '.env'
$jevModel = 'Qwen/Qwen3-4B-Instruct-2507'
if (Test-Path -LiteralPath $jevEnvPath) {
  $jevModelLine = Get-Content -LiteralPath $jevEnvPath | Where-Object { $_ -match '^MODEL=' } | Select-Object -Last 1
  if ($jevModelLine) { $jevModel = $jevModelLine.Substring(6).Trim() }
}
$jevAllowedModels = @('Qwen/Qwen3-4B-Instruct-2507', 'Qwen/Qwen3-8B')
if ($jevModel -notin $jevAllowedModels) {
  throw "Unsupported MODEL '$jevModel'. Select 4b or 8b with npm run model:select:4b or npm run model:select:8b."
}
$jevScript = Join-Path $PSScriptRoot $(if ($Safe) { 'start-vllm-safe.sh' } else { 'start-vllm.sh' })
$jevFullPath = [IO.Path]::GetFullPath($jevScript)
$jevDrive = $jevFullPath.Substring(0, 1).ToLowerInvariant()
$jevRest = $jevFullPath.Substring(2).Replace('\', '/')
$jevLinuxScript = "/mnt/$jevDrive$jevRest"
Write-Host "Starting $jevModel with vLLM XPU."
& wsl.exe -d Ubuntu -- env "URJEV_MODEL=$jevModel" bash $jevLinuxScript
if ($LASTEXITCODE -ne 0) { throw 'vLLM failed. See the output above.' }
