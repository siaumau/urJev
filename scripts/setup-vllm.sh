#!/usr/bin/env bash
set -euo pipefail
# Run in Ubuntu WSL after installing libze-intel-gpu1, libze1,
# intel-opencl-icd and libnuma1 with apt. Keep this environment isolated.
jev_env="$HOME/.local/share/urjev/vllm-env"
export UV_HTTP_TIMEOUT=120
export UV_CONCURRENT_DOWNLOADS=4
uv venv --python 3.12 "$jev_env"
uv pip install --python "$jev_env/bin/python" \
  'vllm==0.29.1rc1.dev452+g3df4ae153.xpu' \
  --extra-index-url https://wheels.vllm.ai/3df4ae153eb385e27b52f26c81f8edb9e20b9984/xpu \
  --extra-index-url https://wheels.vllm.ai/xpu \
  --extra-index-url https://download.pytorch.org/whl/xpu \
  --index-strategy unsafe-best-match
HF_HUB_DISABLE_XET=1 HF_HUB_DOWNLOAD_TIMEOUT=600 "$jev_env/bin/hf" download Qwen/Qwen3-4B-Instruct-2507 --max-workers 2
