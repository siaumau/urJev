param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('4b', '8b')]
  [string]$Model
)
$ErrorActionPreference = 'Stop'
$jevModelId = if ($Model -eq '8b') { 'Qwen/Qwen3-8B' } else { 'Qwen/Qwen3-4B-Instruct-2507' }
$jevCommand = 'HF_HUB_DISABLE_XET=1 HF_HUB_DOWNLOAD_TIMEOUT=1200 ~/.local/share/urjev/vllm-env/bin/hf download ' + $jevModelId + ' --max-workers 2'
Write-Host "Downloading $jevModelId into the WSL Hugging Face cache."
& wsl.exe -d Ubuntu -- bash -lc $jevCommand
if ($LASTEXITCODE -ne 0) { throw "Model download failed with exit code $LASTEXITCODE." }
