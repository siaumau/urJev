"""Compare the installed XPU RMSNorm kernel against a CPU reference."""
import json
import torch
import vllm._xpu_ops
torch.manual_seed(42)
for width in (128, 2560):
    x = torch.randn(4, width, dtype=torch.bfloat16)
    w = torch.randn(width, dtype=torch.bfloat16)
    ref = ((x.float() * torch.rsqrt(x.float().square().mean(-1, keepdim=True) + 1e-6)).to(x.dtype) * w).float()
    xx, ww = x.to('xpu'), w.to('xpu')
    out = torch.full_like(xx, 123)
    torch.ops._C.rms_norm(out, xx, ww, 1e-6)
    torch.xpu.synchronize()
    actual = out.cpu().float()
    print(json.dumps({'width':width,'finite':bool(actual.isfinite().all()),'max_error':float((actual-ref).abs().max()),'unchanged_fraction':float((actual==123).float().mean())}), flush=True)
