param([switch]$Safe)
$ErrorActionPreference = 'Stop'
$jevScript = Join-Path $PSScriptRoot $(if ($Safe) { 'start-vllm-safe.sh' } else { 'start-vllm.sh' })
$jevLinuxScript = (& wsl.exe -d Ubuntu -- wslpath -a $jevScript).Trim()
& wsl.exe -d Ubuntu -- bash $jevLinuxScript
if ($LASTEXITCODE -ne 0) { throw 'vLLM failed. See the output above.' }
