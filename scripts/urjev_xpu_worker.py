"""WSL compatibility for an explicit, bounded KV cache when free VRAM is unavailable."""
import platform
from vllm.v1.worker import xpu_worker


class WSLXPUWorker(xpu_worker.XPUWorker):
    def __init__(self, *args, **kwargs):
        if 'microsoft' in platform.release().lower():
            from vllm.platforms import current_platform
            from vllm.utils.platform_utils import is_pin_memory_available, is_uva_available
            type(current_platform).is_pin_memory_available = classmethod(lambda cls: False)
            is_pin_memory_available.cache_clear()
            is_uva_available.cache_clear()
            xpu_worker.logger.warning('Disabling pinned memory and UVA for WSL XPU compatibility.')
        super().__init__(*args, **kwargs)

    def init_device(self):
        original = xpu_worker.request_memory

        def explicit_wsl_budget(snapshot, config):
            if ('microsoft' in platform.release().lower()
                    and snapshot.free_memory == 0
                    and snapshot.total_memory >= 24 * 1024**3
                    and config.kv_cache_memory_bytes is not None
                    and 0 < config.kv_cache_memory_bytes <= 3 * 1024**3):
                xpu_worker.logger.warning(
                    'WSL reports zero free VRAM. Skipping automatic capacity check '
                    'with an explicit <=3 GiB KV cache; native allocation may still fail. '
                    'Free VRAM remains unknown, not estimated.')
                return config.kv_cache_memory_bytes
            return original(snapshot, config)

        xpu_worker.request_memory = explicit_wsl_budget
        try:
            super().init_device()
        finally:
            xpu_worker.request_memory = original
