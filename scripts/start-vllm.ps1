param([switch]$Safe)
$ErrorActionPreference = 'Stop'
$jevScript = Join-Path $PSScriptRoot $(if ($Safe) { 'start-vllm-safe.sh' } else { 'start-vllm.sh' })
$jevFullPath = [IO.Path]::GetFullPath($jevScript)
$jevDrive = $jevFullPath.Substring(0, 1).ToLowerInvariant()
$jevRest = $jevFullPath.Substring(2).Replace('\', '/')
$jevLinuxScript = "/mnt/$jevDrive$jevRest"
& wsl.exe -d Ubuntu -- bash $jevLinuxScript
if ($LASTEXITCODE -ne 0) { throw 'vLLM failed. See the output above.' }
