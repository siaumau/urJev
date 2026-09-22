$ErrorActionPreference = 'Stop'
$jevRoot = Split-Path $PSScriptRoot -Parent
$jevRuntime = Join-Path $jevRoot '.runtime'
try {
  $null = Invoke-RestMethod 'http://127.0.0.1:11435/api/tags' -TimeoutSec 2
  Write-Host 'Ollama is already running on port 11435.'
  return
} catch {}
$jevExe = Join-Path $jevRuntime 'ollama/ollama.exe'
if (-not (Test-Path -LiteralPath $jevExe)) { throw 'Run npm run setup:local first.' }
$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_MODELS = Join-Path $jevRuntime 'models'
$jevProcess = Start-Process -FilePath $jevExe -ArgumentList 'serve' -WorkingDirectory $jevRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $jevRuntime 'ollama.stdout.log') -RedirectStandardError (Join-Path $jevRuntime 'ollama.stderr.log')
$jevProcess.Id | Set-Content (Join-Path $jevRuntime 'ollama.pid')
for ($jevAttempt = 0; $jevAttempt -lt 30; $jevAttempt++) {
  Start-Sleep -Milliseconds 500
  if ($jevProcess.HasExited) { throw 'Ollama exited. Check .runtime/ollama.stderr.log.' }
  try { $null = Invoke-RestMethod 'http://127.0.0.1:11435/api/tags' -TimeoutSec 1; Write-Host "Ollama started (PID $($jevProcess.Id))."; return } catch {}
}
throw 'Ollama did not become ready. Check .runtime/ollama.stderr.log.'
