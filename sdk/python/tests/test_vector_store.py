import unittest
from alp_sdk.vector_store import VectorStoreEngine, VectorEntry

class TestVectorStore(unittest.TestCase):
    def test_add_and_query_vectors(self):
        engine = VectorStoreEngine()
        engine.add_entry(VectorEntry("v1", "Auth API", [1.0, 0.0, 0.0]))
        engine.add_entry(VectorEntry("v2", "Database DB", [0.0, 1.0, 0.0]))

        self.assertEqual(engine.size(), 2)

        results = engine.query_similar([0.95, 0.05, 0.0], top_k=2)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].id, "v1")
        self.assertGreater(results[0].score, results[1].score)

if __name__ == "__main__":
    unittest.main()
