import unittest
from alp_sdk.edge_model import EdgeModelEngine, EdgeModelConfig, OfflineInferenceResult


class TestEdgeModelConfig(unittest.TestCase):
    def test_default_values(self):
        config = EdgeModelConfig(
            model_id="llama-3b",
            model_name="Llama-3.2-3B",
            gguf_path="models/llama3.gguf",
        )
        self.assertEqual(config.id, "llama-3b")
        self.assertEqual(config.model_name, "Llama-3.2-3B")
        self.assertEqual(config.gguf_path, "models/llama3.gguf")
        self.assertEqual(config.quantization, "Q4_K_M")
        self.assertEqual(config.context_window, 4096)
        self.assertEqual(config.threads, 4)
        self.assertTrue(config.is_bound)
        self.assertIsNotNone(config.created_at)

    def test_custom_quantization(self):
        config = EdgeModelConfig(
            model_id="phi-mini",
            model_name="Phi-3-Mini",
            gguf_path="models/phi3.gguf",
            quantization="Q5_K_S",
            context_window=8192,
            threads=8,
        )
        self.assertEqual(config.quantization, "Q5_K_S")
        self.assertEqual(config.context_window, 8192)
        self.assertEqual(config.threads, 8)


class TestEdgeModelEngine(unittest.TestCase):
    def test_bind_local_model(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model(
            model_id="edge-llama",
            model_name="Llama-3.2-3B",
            gguf_path="models/llama3.gguf",
        )
        self.assertEqual(config.id, "edge-llama")
        self.assertEqual(config.model_name, "Llama-3.2-3B")
        self.assertTrue(config.is_bound)
        self.assertIn("edge-llama", engine.models)

    def test_bind_multiple_models(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("m1", "Llama-3.2", "a.gguf")
        engine.bind_local_model("m2", "Phi-3", "b.gguf")
        self.assertEqual(len(engine.models), 2)

    def test_execute_offline_inference_success(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("edge-local", "Phi-3-Mini", "models/phi3.gguf")
        result = engine.execute_offline_inference("edge-local", "Hello world")
        self.assertTrue(result.offline)
        self.assertGreater(result.tokens_generated, 0)
        self.assertGreater(result.tok_per_sec, 0)
        self.assertIn("Phi-3-Mini", result.completion)

    def test_execute_offline_inference_unbound_model(self):
        engine = EdgeModelEngine()
        result = engine.execute_offline_inference("missing-model", "test prompt")
        self.assertEqual(result.tokens_generated, 0)
        self.assertEqual(result.tok_per_sec, 0.0)
        self.assertIn("not bound", result.completion)

    def test_execute_offline_inference_max_tokens(self):
        engine = EdgeModelEngine()
        engine.bind_local_model("t1", "Test", "test.gguf")
        result = engine.execute_offline_inference("t1", "prompt", max_tokens=10)
        self.assertLessEqual(result.tokens_generated, 10)

    def test_verify_local_model_availability_valid(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model("v1", "Model", "weights.gguf")
        self.assertTrue(engine.verify_local_model_availability(config))

    def test_verify_local_model_availability_wrong_extension(self):
        engine = EdgeModelEngine()
        config = engine.bind_local_model("v2", "Model", "weights.bin")
        self.assertFalse(engine.verify_local_model_availability(config))

    def test_verify_local_model_availability_unbound(self):
        config = EdgeModelConfig(
            model_id="unbound",
            model_name="Test",
            gguf_path="model.gguf",
            is_bound=False,
        )
        engine = EdgeModelEngine()
        self.assertFalse(engine.verify_local_model_availability(config))


class TestOfflineInferenceResult(unittest.TestCase):
    def test_result_fields(self):
        result = OfflineInferenceResult(
            model_id="test-id",
            prompt="hello",
            completion="world",
            tokens_generated=10,
            tok_per_sec=55.5,
        )
        self.assertEqual(result.model_id, "test-id")
        self.assertEqual(result.prompt, "hello")
        self.assertEqual(result.completion, "world")
        self.assertEqual(result.tokens_generated, 10)
        self.assertEqual(result.tok_per_sec, 55.5)
        self.assertTrue(result.offline)
