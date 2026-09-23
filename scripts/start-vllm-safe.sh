#!/usr/bin/env bash
set -euo pipefail
jev_env="$HOME/.local/share/urjev/vllm-env"
jev_model="${URJEV_MODEL:-Qwen/Qwen3-4B-Instruct-2507}"
export VLLM_NO_USAGE_STATS=1
export DO_NOT_TRACK=1
export HF_HUB_DISABLE_TELEMETRY=1
export VLLM_USE_V2_MODEL_RUNNER=0
export PATH="$jev_env/bin:$PATH"
export PYTHONPATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)${PYTHONPATH:+:$PYTHONPATH}"
exec "$jev_env/bin/vllm" serve "$jev_model" \
  --host 127.0.0.1 --port 18000 --dtype bfloat16 \
  --max-model-len 8192 --max-num-seqs 4 --gpu-memory-utilization 0.65 \
  --kv-cache-memory-bytes 2147483648 --worker-cls urjev_xpu_worker.WSLXPUWorker \
  --no-async-scheduling --no-enable-prefix-caching \
  --attention-config '{"backend":"TRITON_ATTN"}' \
  --compilation-config '{"custom_ops":["none"]}' \
  --kernel-config '{"ir_op_priority":{"rms_norm":["native"],"fused_add_rms_norm":["native"]}}' \
  --model-impl transformers \
  --enforce-eager --enable-per-request-metrics
