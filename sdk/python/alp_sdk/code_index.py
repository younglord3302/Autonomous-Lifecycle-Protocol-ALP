from __future__ import annotations

import re
import math
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class CodeSymbol:
    def __init__(self, name: str, kind: str, line: int, signature: str, doc: str = ""):
        self.name = name
        self.kind = kind
        self.line = line
        self.signature = signature
        self.doc = doc

class CodeChunk:
    def __init__(
        self,
        chunk_id: str,
        source_path: str,
        language: str,
        symbol_name: str,
        kind: str,
        content: str,
        start_line: int,
        end_line: int,
        embedding: List[float],
    ):
        self.id = chunk_id
        self.source_path = source_path
        self.language = language
        self.symbol_name = symbol_name
        self.kind = kind
        self.content = content
        self.start_line = start_line
        self.end_line = end_line
        self.embedding = embedding

class SemanticSearchResult:
    def __init__(self, chunk: CodeChunk, score: float):
        self.chunk = chunk
        self.score = score

class CodeIndexConfig:
    def __init__(
        self,
        index_id: str,
        language: str,
        source_path: str,
        symbols: List[CodeSymbol],
        embedding_model: str = "alp-code-embed-v1",
        chunk_strategy: str = "function",
        indexed_at: Optional[str] = None,
    ):
        self.id = index_id
        self.language = language
        self.source_path = source_path
        self.symbols = symbols
        self.embedding_model = embedding_model
        self.chunk_strategy = chunk_strategy
        self.indexed_at = indexed_at or datetime.now(timezone.utc).isoformat()

def simple_embedding(text: str, dims: int = 64) -> List[float]:
    vec = [0.0] * dims
    for char in text:
        vec[ord(char) % dims] += 1.0
    mag = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / mag for v in vec]

def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a)) or 1.0
    mag_b = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (mag_a * mag_b)

class CodeIndexEngine:
    def __init__(self):
        self.indices: Dict[str, CodeIndexConfig] = {}
        self.chunks: List[CodeChunk] = []

    def index_source(
        self,
        index_id: str,
        language: str,
        source_path: str,
        source_code: str,
        chunk_strategy: str = "function",
        embedding_model: str = "alp-code-embed-v1",
    ) -> CodeIndexConfig:
        symbols = self._extract_symbols(source_code, language)
        new_chunks = self._chunk_source(index_id, source_path, language, source_code, symbols, chunk_strategy)
        self.chunks.extend(new_chunks)

        config = CodeIndexConfig(
            index_id=index_id,
            language=language,
            source_path=source_path,
            symbols=symbols,
            embedding_model=embedding_model,
            chunk_strategy=chunk_strategy,
        )
        self.indices[index_id] = config
        return config

    def semantic_search(self, query: str, top_k: int = 5) -> List[SemanticSearchResult]:
        if not self.chunks:
            return []

        query_embed = simple_embedding(query)
        results = [
            SemanticSearchResult(chunk=chunk, score=cosine_similarity(query_embed, chunk.embedding))
            for chunk in self.chunks
        ]
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    def get_index(self, index_id: str) -> Optional[CodeIndexConfig]:
        return self.indices.get(index_id)

    def get_chunk_count(self) -> int:
        return len(self.chunks)

    def list_indices(self) -> List[CodeIndexConfig]:
        return list(self.indices.values())

    def _extract_symbols(self, source: str, language: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        lines = source.split("\n")
        for idx, line in enumerate(lines):
            stripped = line.strip()

            # Python def / class
            def_match = re.match(r"^def\s+(\w+)\s*\(([^)]*)\)", stripped)
            if def_match:
                symbols.append(CodeSymbol(name=def_match.group(1), kind="function", line=idx + 1, signature=def_match.group(0)))
                continue

            class_match = re.match(r"^class\s+(\w+)", stripped)
            if class_match:
                symbols.append(CodeSymbol(name=class_match.group(1), kind="class", line=idx + 1, signature=class_match.group(1)))
                continue

            # JS/TS export function / class
            fn_match = re.match(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)", stripped)
            if fn_match:
                symbols.append(CodeSymbol(name=fn_match.group(1), kind="function", line=idx + 1, signature=fn_match.group(0)))
                continue

            if_match = re.match(r"^(?:export\s+)?interface\s+(\w+)", stripped)
            if if_match:
                symbols.append(CodeSymbol(name=if_match.group(1), kind="interface", line=idx + 1, signature=if_match.group(1)))

        return symbols

    def _chunk_source(
        self,
        index_id: str,
        source_path: str,
        language: str,
        source: str,
        symbols: List[CodeSymbol],
        strategy: str,
    ) -> List[CodeChunk]:
        lines = source.split("\n")
        if strategy == "file" or not symbols:
            embed = simple_embedding(source)
            return [
                CodeChunk(
                    chunk_id=f"{index_id}:file",
                    source_path=source_path,
                    language=language,
                    symbol_name=source_path,
                    kind="module",
                    content=source,
                    start_line=1,
                    end_line=len(lines),
                    embedding=embed,
                )
            ]

        chunks = []
        for i, sym in enumerate(symbols):
            start_line = sym.line
            end_line = symbols[i + 1].line - 1 if i + 1 < len(symbols) else len(lines)
            content = "\n".join(lines[start_line - 1 : end_line])
            chunks.append(
                CodeChunk(
                    chunk_id=f"{index_id}:{sym.name}",
                    source_path=source_path,
                    language=language,
                    symbol_name=sym.name,
                    kind=sym.kind,
                    content=content,
                    start_line=start_line,
                    end_line=end_line,
                    embedding=simple_embedding(content),
                )
            )
        return chunks
