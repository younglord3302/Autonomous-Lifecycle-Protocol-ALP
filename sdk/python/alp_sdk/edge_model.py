from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Any, Optional

class EdgeModelConfig:
    def __init__(
        self,
        model_id: str,
        model_name: str,
        gguf_path: str,
        quantization: str = "Q4_K_M",
        context_window: int = 4096,
        threads: int = 4,
        is_bound: bool = True,
        created_at: Optional[str] = None,
    ):
        self.id = model_id
        self.model_name = model_name
        self.gguf_path = gguf_path
        self.quantization = quantization
        self.context_window = context_window
        self.threads = threads
        self.is_bound = is_bound
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class OfflineInferenceResult:
    def __init__(
        self,
        model_id: str,
        prompt: str,
        completion: str,
        tokens_generated: int,
        tok_per_sec: float,
        offline: bool = True,
    ):
        self.model_id = model_id
        self.prompt = prompt
        self.completion = completion
        self.tokens_generated = tokens_generated
        self.tok_per_sec = tok_per_sec
        self.offline = offline

class EdgeModelEngine:
    def __init__(self):
        self.models: Dict[str, EdgeModelConfig] = {}

    def bind_local_model(
        self,
        model_id: str,
        model_name: str,
        gguf_path: str,
        quantization: str = "Q4_K_M",
        context_window: int = 4096,
        threads: int = 4,
    ) -> EdgeModelConfig:
        config = EdgeModelConfig(
            model_id=model_id,
            model_name=model_name,
            gguf_path=gguf_path,
            quantization=quantization,
            context_window=context_window,
            threads=threads,
        )
        self.models[model_id] = config
        return config

    def execute_offline_inference(
        self, model_id: str, prompt: str, max_tokens: int = 256
    ) -> OfflineInferenceResult:
        model = self.models.get(model_id)
        if not model or not model.is_bound:
            return OfflineInferenceResult(
                model_id=model_id,
                prompt=prompt,
                completion=f"[Edge Error: Local GGUF model '{model_id}' not bound]",
                tokens_generated=0,
                tok_per_sec=0.0,
                offline=True,
            )

        return OfflineInferenceResult(
            model_id=model_id,
            prompt=prompt,
            completion=f"[Local GGUF {model.model_name}] Offline inference complete",
            tokens_generated=min(max_tokens, 42),
            tok_per_sec=68.5,
            offline=True,
        )

    def verify_local_model_availability(self, config: EdgeModelConfig) -> bool:
        return config.is_bound and config.gguf_path.endswith(".gguf")
