import json
import torch

if not torch.xpu.is_available():
    raise SystemExit('Intel XPU is not available. Check WSL GPU userspace drivers.')
device = torch.xpu.get_device_properties(0)
x = torch.ones((128, 128), device='xpu', dtype=torch.bfloat16)
y = x @ x
torch.xpu.synchronize()
assert y[0, 0].item() == 128
print(json.dumps({
    'torch': torch.__version__,
    'device': device.name,
    'total_memory_bytes': device.total_memory,
    'bf16_matmul': 'passed',
}))
