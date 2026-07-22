import unittest
from alp_sdk.memory_mesh import MemoryMeshEngine


class TestMemoryMeshEngine(unittest.TestCase):
    def test_store_and_query_memory(self):
        engine = MemoryMeshEngine()
        engine.store_memory('mem-1', 'agent-coder', 'auth-refactor', 'Refactored auth module with JWT tokens', ['security', 'auth'])
        engine.store_memory('mem-2', 'agent-tester', 'test-coverage', 'Added vitest integration tests for auth', ['testing', 'auth'])

        results = engine.query_memory_mesh('auth JWT', top_k=2)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].node.id, 'mem-1')
        self.assertGreater(results[0].score, 0)

    def test_mesh_stats(self):
        engine = MemoryMeshEngine()
        engine.store_memory('m1', 'agent-a', 'k1', 'c1', ['core'])
        engine.store_memory('m2', 'agent-b', 'k2', 'c2', ['core', 'v38'])

        stats = engine.get_mesh_stats()
        self.assertEqual(stats.total_memories, 2)
        self.assertEqual(stats.active_agents, 2)
        self.assertEqual(stats.tag_counts['core'], 2)
        self.assertEqual(stats.tag_counts['v38'], 1)
