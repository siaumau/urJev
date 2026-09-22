"""Fuse only the native normalization functions; retain the WSL safety workarounds.

This uses vLLM's internal IR registry and is verified against the pinned XPU wheel.
The safe launch profile uses WSLXPUWorker directly and does not install this hook.
"""
import torch
import vllm
from vllm import ir
from urjev_xpu_worker import WSLXPUWorker

class CompiledNormWorker(WSLXPUWorker):
    def __init__(self,*args,**kwargs):
        if not vllm.__version__.startswith('0.29.1rc1.dev452+g3df4ae153'):
            raise RuntimeError('Compiled normalization requires the validated vLLM version; use model:vllm:safe or revalidate the hook.')
        for name in ('rms_norm','fused_add_rms_norm'):
            impl=getattr(ir.ops,name).impls['native']
            impl.impl_fn=torch.compile(impl.impl_fn,fullgraph=True,dynamic=True)
        super().__init__(*args,**kwargs)
