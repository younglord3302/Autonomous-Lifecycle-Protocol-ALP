import pytest
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

class TestCodeIndexConfig:
    def test_default_values(self):
        config = CodeIndexConfig("idx-1", "python", "app.py", [])
        assert config.id == "idx-1"
        assert config.language == "python"
        assert config.source_path == "app.py"
        assert config.symbols == []
        assert config.embedding_model == "alp-code-embed-v1"
        assert config.chunk_strategy == "function"
        assert config.indexed_at is not None

class TestCodeIndexEngine:
    def test_index_source_extracts_symbols(self):
        engine = CodeIndexEngine()
        config = engine.index_source("idx-py", "python", "pipeline.py", SAMPLE_PYTHON)
        assert config.id == "idx-py"
        assert len(config.symbols) == 4
        assert config.symbols[0].name == "process_data"
        assert config.symbols[0].kind == "function"
        assert config.symbols[1].name == "DataPipeline"
        assert config.symbols[1].kind == "class"

    def test_semantic_search_returns_ranked_results(self):
        engine = CodeIndexEngine()
        engine.index_source("idx-py", "python", "pipeline.py", SAMPLE_PYTHON)
        results = engine.semantic_search("process data function", top_k=2)
        assert len(results) > 0
        assert results[0].score > 0
        assert isinstance(results[0], SemanticSearchResult)
        assert results[0].chunk.source_path == "pipeline.py"

    def test_file_chunk_strategy(self):
        engine = CodeIndexEngine()
        config = engine.index_source("idx-file", "python", "script.py", "x = 42", chunk_strategy="file")
        assert len(config.symbols) == 0
        assert engine.get_chunk_count() == 1
        results = engine.semantic_search("x = 42", top_k=1)
        assert len(results) == 1

    def test_list_indices(self):
        engine = CodeIndexEngine()
        engine.index_source("idx-1", "python", "a.py", "def f(): pass")
        engine.index_source("idx-2", "typescript", "b.ts", "function g() {}")
        assert len(engine.list_indices()) == 2
        assert engine.get_index("idx-1") is not None

class TestEmbeddingUtils:
    def test_simple_embedding_length(self):
        vec = simple_embedding("test text", dims=64)
        assert len(vec) == 64

    def test_cosine_similarity_identical(self):
        v = simple_embedding("hello", dims=16)
        sim = cosine_similarity(v, v)
        assert pytest.approx(sim, 0.001) == 1.0
