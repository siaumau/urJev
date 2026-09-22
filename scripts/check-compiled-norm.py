import json, torch
from vllm import ir
torch.manual_seed(42)
for name in ('rms_norm','fused_add_rms_norm'):
    fn=getattr(ir.ops,name).impls['native'].impl_fn
    compiled=torch.compile(fn,fullgraph=True,dynamic=True)
    for width in (128,2560):
        for rows in (1,5,64):
            x=torch.randn(rows,width,dtype=torch.bfloat16)
            w=torch.randn(width,dtype=torch.bfloat16)
            args=(x,w,1e-6) if name=='rms_norm' else (x,torch.randn_like(x),w,1e-6)
            ref=fn(*args)
            actual=compiled(*(a.to('xpu') if isinstance(a,torch.Tensor) else a for a in args))
            actual=(actual,) if isinstance(actual,torch.Tensor) else actual
            ref=(ref,) if isinstance(ref,torch.Tensor) else ref
            errors=[float((a.cpu().float()-r.float()).abs().max()) for a,r in zip(actual,ref)]
            passed=all(torch.allclose(a.cpu().float(),r.float(),atol=.0625,rtol=.02) for a,r in zip(actual,ref))
            print(json.dumps(dict(name=name,width=width,rows=rows,errors=errors,passed=passed)),flush=True)
            assert passed
