import unittest
from alp_sdk.crdt_sync import CRDTSyncEngine

class TestCRDTSync(unittest.TestCase):
    def test_crdt_set_and_merge(self):
        engine_a = CRDTSyncEngine()
        state_a = engine_a.set("doc-1", "@peer-a", "status", "[x]", 100.0)

        engine_b = CRDTSyncEngine()
        state_b = engine_b.set("doc-1", "@peer-b", "status", "[~]", 200.0)

        merged = engine_a.merge(state_a, state_b)
        res = engine_a.read_state("doc-1")
        self.assertEqual(res["status"], "[~]")
        self.assertGreater(merged.clock, 0)

if __name__ == "__main__":
    unittest.main()
