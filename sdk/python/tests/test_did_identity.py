import unittest
from alp_sdk.did_identity import DIDIdentityEngine

class TestDIDIdentity(unittest.TestCase):
    def test_create_and_anchor_did(self):
        engine = DIDIdentityEngine()
        doc = engine.create_did("agent-devops", "alp-mainnet-1")
        self.assertEqual(doc.id, "did-agent-devops")
        self.assertTrue(doc.did_uri.startswith("did:alp:alp-mainnet-1:"))

        receipt = engine.anchor_to_ledger(doc)
        self.assertEqual(receipt.did_uri, doc.did_uri)
        self.assertEqual(receipt.status, "CONFIRMED")
        self.assertTrue(engine.verify_did_anchor(doc))

if __name__ == "__main__":
    unittest.main()
