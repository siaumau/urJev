param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('4b', '8b')]
  [string]$Model
)
$ErrorActionPreference = 'Stop'
$jevRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$jevEnvPath = Join-Path $jevRoot '.env'
$jevModelId = if ($Model -eq '8b') { 'Qwen/Qwen3-8B' } else { 'Qwen/Qwen3-4B-Instruct-2507' }
if (-not (Test-Path -LiteralPath $jevEnvPath)) {
  Copy-Item -LiteralPath (Join-Path $jevRoot '.env.vllm.example') -Destination $jevEnvPath
}
$jevContent = [IO.File]::ReadAllText($jevEnvPath)
if ($jevContent -match '(?m)^MODEL=.*$') {
  $jevContent = [regex]::Replace($jevContent, '(?m)^MODEL=.*$', "MODEL=$jevModelId")
} else {
  $jevContent = $jevContent.TrimEnd() + [Environment]::NewLine + "MODEL=$jevModelId" + [Environment]::NewLine
}
[IO.File]::WriteAllText($jevEnvPath, $jevContent, [Text.UTF8Encoding]::new($false))
Write-Host "Selected $jevModelId. Restart vLLM and the urJev web service to apply it."
