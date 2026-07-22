import unittest
from alp_sdk.code_index import (
    CodeIndexEngine,
    CodeIndexConfig,
    CodeSymbol,
    CodeChunk,
    SemanticSearchResult,
    simple_embedding,
    cosine_similarity,
)

SAMPLE_PYTHON = """
def process_data(items):
    return [x * 2 for x in items]

class DataPipeline:
    def __init__(self):
        self.steps = []

    def run(self):
        print("Running pipeline")
"""

class TestCodeIndexConfig(unittest.TestCase):
    def test_default_values(self):
        config = CodeIndexConfig("idx-1", "python", "app.py", [])
        self.assertEqual(config.id, "idx-1")
        self.assertEqual(config.language, "python")
        self.assertEqual(config.source_path, "app.py")
        self.assertEqual(config.symbols, [])
        self.assertEqual(config.embedding_model, "alp-code-embed-v1")
        self.assertEqual(config.chunk_strategy, "function")
        self.assertIsNotNone(config.indexed_at)

class TestCodeIndexEngine(unittest.TestCase):
    def test_index_source_extracts_symbols(self):
        engine = CodeIndexEngine()
        config = engine.index_source("idx-py", "python", "pipeline.py", SAMPLE_PYTHON)
        self.assertEqual(config.id, "idx-py")
        self.assertEqual(len(config.symbols), 4)
        self.assertEqual(config.symbols[0].name, "process_data")
        self.assertEqual(config.symbols[0].kind, "function")
        self.assertEqual(config.symbols[1].name, "DataPipeline")
        self.assertEqual(config.symbols[1].kind, "class")

    def test_semantic_search_returns_ranked_results(self):
        engine = CodeIndexEngine()
        engine.index_source("idx-py", "python", "pipeline.py", SAMPLE_PYTHON)
        results = engine.semantic_search("process data function", top_k=2)
        self.assertGreater(len(results), 0)
        self.assertGreater(results[0].score, 0)
        self.assertIsInstance(results[0], SemanticSearchResult)
        self.assertEqual(results[0].chunk.source_path, "pipeline.py")

    def test_file_chunk_strategy(self):
        engine = CodeIndexEngine()
        config = engine.index_source("idx-file", "python", "script.py", "x = 42", chunk_strategy="file")
        self.assertEqual(len(config.symbols), 0)
        self.assertEqual(engine.get_chunk_count(), 1)
        results = engine.semantic_search("x = 42", top_k=1)
        self.assertEqual(len(results), 1)

    def test_list_indices(self):
        engine = CodeIndexEngine()
        engine.index_source("idx-1", "python", "a.py", "def f(): pass")
        engine.index_source("idx-2", "typescript", "b.ts", "function g() {}")
        self.assertEqual(len(engine.list_indices()), 2)
        self.assertIsNotNone(engine.get_index("idx-1"))

class TestEmbeddingUtils(unittest.TestCase):
    def test_simple_embedding_length(self):
        vec = simple_embedding("test text", dims=64)
        self.assertEqual(len(vec), 64)

    def test_cosine_similarity_identical(self):
        v = simple_embedding("hello", dims=16)
        sim = cosine_similarity(v, v)
        self.assertAlmostEqual(sim, 1.0, places=3)
