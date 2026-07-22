import math
from typing import List, Dict, Any, Optional

class VectorEntry:
    def __init__(self, entry_id: str, text: str, vector: List[float], metadata: Optional[Dict[str, Any]] = None):
        self.id = entry_id
        self.text = text
        self.vector = vector
        self.metadata = metadata or {}

class VectorSearchResult:
    def __init__(self, entry_id: str, text: str, score: float, metadata: Optional[Dict[str, Any]] = None):
        self.id = entry_id
        self.text = text
        self.score = score
        self.metadata = metadata or {}

class VectorStoreEngine:
    def __init__(self):
        self.entries: Dict[str, VectorEntry] = {}

    def add_entry(self, entry: VectorEntry):
        self.entries[entry.id] = entry

    def get_entry(self, entry_id: str) -> Optional[VectorEntry]:
        return self.entries.get(entry_id)

    def cosine_similarity(self, a: List[float], b: List[float]) -> float:
        if len(a) != len(b) or len(a) == 0:
            return 0.0
        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return dot_product / (norm_a * norm_b)

    def query_similar(self, query_vector: List[float], top_k: int = 3) -> List[VectorSearchResult]:
        results = []
        for entry in self.entries.values():
            score = self.cosine_similarity(query_vector, entry.vector)
            results.append(VectorSearchResult(entry.id, entry.text, score, entry.metadata))

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def size(self) -> int:
        return len(self.entries)
