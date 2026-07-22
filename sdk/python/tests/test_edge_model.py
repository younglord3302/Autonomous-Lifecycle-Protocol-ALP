import pytest
from alp_sdk.edge_model import EdgeModelEngine, EdgeModelConfig, OfflineInferenceResult


class TestEdgeModelConfig:
    def test_default_values(self):
        config = EdgeModelConfig(
            model_id="llama-3b",
            model_name="Llama-3.2-3B",
            gguf_path="models/llama3.gguf",
        )
        assert config.id == "llama-3b"
        assert config.model_name == "Llama-3.2-3B"
        assert config.gguf_path == "models/llama3.gguf"
        assert config.quantization == "Q4_K_M"
        assert config.context_window == 4096
        assert config.threads == 4
        assert config.is_bound is True
        assert config.created_at is not None

    def test_custom_quantization(self):
        config = EdgeModelConfig(
            model_id="phi-mini",
            model_name="Phi-3-Mini",
            gguf_path="models/phi3.gguf",
            quantization="Q5_K_S",
            context_window=8192,
            threads=8,
        )
        assert config.quantization == "Q5_K_S"
        assert config.context_window == 8192
        assert config.threads == 8


class TestEdgeModelEngine:
    def test_bind_local_model(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model(
            model_id="edge-llama",
            model_name="Llama-3.2-3B",
            gguf_path="models/llama3.gguf",
        )
        assert config.id == "edge-llama"
        assert config.model_name == "Llama-3.2-3B"
        assert config.is_bound is True
        assert "edge-llama" in engine.models

    def test_bind_multiple_models(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("m1", "Llama-3.2", "a.gguf")
        engine.bind_local_model("m2", "Phi-3", "b.gguf")
        assert len(engine.models) == 2

    def test_execute_offline_inference_success(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("edge-local", "Phi-3-Mini", "models/phi3.gguf")
        result = engine.execute_offline_inference("edge-local", "Hello world")
        assert result.offline is True
        assert result.tokens_generated > 0
        assert result.tok_per_sec > 0
        assert "Phi-3-Mini" in result.completion

    def test_execute_offline_inference_unbound_model(self):
        engine = EdgeModelEngine()
        result = engine.execute_offline_inference("missing-model", "test prompt")
        assert result.tokens_generated == 0
        assert result.tok_per_sec == 0.0
        assert "not bound" in result.completion

    def test_execute_offline_inference_max_tokens(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("t1", "Test", "test.gguf")
        result = engine.execute_offline_inference("t1", "prompt", max_tokens=10)
        assert result.tokens_generated <= 10

    def test_verify_local_model_availability_valid(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model("v1", "Model", "weights.gguf")
        assert engine.verify_local_model_availability(config) is True

    def test_verify_local_model_availability_wrong_extension(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model("v2", "Model", "weights.bin")
        assert engine.verify_local_model_availability(config) is False

    def test_verify_local_model_availability_unbound(self):
        config = EdgeModelConfig(
            model_id="unbound",
            model_name="Test",
            gguf_path="model.gguf",
            is_bound=False,
        )
        engine = EdgeModelEngine()
        assert engine.verify_local_model_availability(config) is False


class TestOfflineInferenceResult:
    def test_result_fields(self):
        result = OfflineInferenceResult(
            model_id="test-id",
            prompt="hello",
            completion="world",
            tokens_generated=10,
            tok_per_sec=55.5,
        )
        assert result.model_id == "test-id"
        assert result.prompt == "hello"
        assert result.completion == "world"
        assert result.tokens_generated == 10
        assert result.tok_per_sec == 55.5
        assert result.offline is True
