import unittest
from alp_sdk.zk_proof import ZKProofEngine

class TestZKProof(unittest.TestCase):
    def test_generate_and_verify_zk_proof(self):
        engine = ZKProofEngine()
        proof = engine.generate_proof("zk-1", "policy-check-pass", "secret-key-999")
        self.assertEqual(proof.id, "zk-1")
        self.assertEqual(proof.statement, "policy-check-pass")
        self.assertTrue(proof.verified)

        is_valid = engine.verify_proof(proof)
        self.assertTrue(is_valid)

    def test_tampered_zk_proof(self):
        engine = ZKProofEngine()
        proof = engine.generate_proof("zk-2", "vault-access", "secret-token")
        proof.statement = "unauthorized-statement"
        self.assertFalse(engine.verify_proof(proof))

if __name__ == "__main__":
    unittest.main()
