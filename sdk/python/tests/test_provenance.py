import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    TraceSigner,
    ProvenanceStore,
    AuditLedger,
    VerifiableCredential,
    ZKPolicyProof,
    ComplianceCertifier,
)


class TestTraceSigner(unittest.TestCase):
    def test_seal_adds_envelope(self):
        signer = TraceSigner()
        sealed = signer.seal({"task_id": "t1", "status": "[x]"}, "agent-1")
        self.assertIn("_sealed", sealed)
        self.assertEqual(sealed["_sealed"]["recipient"], "agent-1")
        self.assertIn("digest", sealed["_sealed"])

    def test_verify_valid_seal(self):
        signer = TraceSigner()
        sealed = signer.seal({"task_id": "t1"}, "agent-1")
        self.assertTrue(signer.verify(sealed))

    def test_verify_rejects_tampered(self):
        signer = TraceSigner()
        sealed = signer.seal({"task_id": "t1"}, "agent-1")
        sealed["task_id"] = "t2"
        self.assertFalse(signer.verify(sealed))


class TestProvenanceStore(unittest.TestCase):
    def test_add_trace_chains(self):
        store = ProvenanceStore()
        t1 = store.add_trace({"trace_id": "run-1", "step": 1})
        t2 = store.add_trace({"trace_id": "run-1", "step": 2})
        self.assertEqual(t1["_parent"], "genesis")
        self.assertEqual(t2["_parent"], t1["_hash"])

    def test_verify_chain_valid(self):
        store = ProvenanceStore()
        store.add_trace({"trace_id": "run-1", "step": 1})
        store.add_trace({"trace_id": "run-1", "step": 2})
        self.assertTrue(store.verify_chain())

    def test_lineage_filters_by_trace_id(self):
        store = ProvenanceStore()
        store.add_trace({"trace_id": "run-1", "step": 1})
        store.add_trace({"trace_id": "run-2", "step": 1})
        lineage = store.lineage("run-1")
        self.assertEqual(len(lineage), 1)
        self.assertEqual(lineage[0]["trace_id"], "run-1")


class TestAuditLedger(unittest.TestCase):
    def test_append_creates_entry(self):
        ledger = AuditLedger()
        entry = ledger.append({"action": "deploy", "agent": "ci-bot"})
        self.assertEqual(entry["_index"], 0)
        self.assertEqual(entry["_prev"], "genesis")
        self.assertIn("_hash", entry)

    def test_verify_valid_chain(self):
        ledger = AuditLedger()
        ledger.append({"a": 1})
        ledger.append({"a": 2})
        self.assertTrue(ledger.verify())

    def test_tail_returns_last_n(self):
        ledger = AuditLedger()
        for i in range(5):
            ledger.append({"i": i})
        tail = ledger.tail(2)
        self.assertEqual(len(tail), 2)
        self.assertEqual(tail[0]["i"], 3)
        self.assertEqual(tail[1]["i"], 4)


class TestVerifiableCredential(unittest.TestCase):
    def test_to_dict_round_trip(self):
        vc = VerifiableCredential("vc-1", "agent-1", "root-1", {"role": "admin"})
        d = vc.to_dict()
        self.assertEqual(d["agent"], "agent-1")
        self.assertEqual(d["claims"]["role"], "admin")
        self.assertIn("issued_at", d)


class TestZKPolicyProof(unittest.TestCase):
    def test_generate_creates_proof_data(self):
        proof = ZKPolicyProof("policy-1", "read")
        data = proof.generate({"secret": "value"})
        self.assertEqual(data["policy_id"], "policy-1")
        self.assertEqual(data["action"], "read")
        self.assertIn("witness_hash", data)

    def test_verify_valid_proof(self):
        proof = ZKPolicyProof("policy-1", "read")
        proof.generate({"secret": "value"})
        self.assertTrue(proof.verify())

    def test_verify_rejects_empty_proof(self):
        proof = ZKPolicyProof("policy-1", "read")
        self.assertFalse(proof.verify())

    def test_verify_with_trust_root(self):
        proof = ZKPolicyProof("policy-1", "read")
        proof.generate({"secret": "value"})
        self.assertTrue(proof.verify({"namespace": "policy-1"}))
        self.assertFalse(proof.verify({"namespace": "other"}))

    def test_to_dict_after_verify(self):
        proof = ZKPolicyProof("policy-1", "read")
        proof.generate({"secret": "value"})
        proof.verify()
        d = proof.to_dict()
        self.assertTrue(d["verified"])
        self.assertIn("verified_at", d)


class TestComplianceCertifier(unittest.TestCase):
    def test_certify_passing_run(self):
        certifier = ComplianceCertifier()
        results = [{"check": "a", "passed": True}, {"check": "b", "passed": True}]
        bundle = certifier.certify("run-1", "default", results)
        self.assertTrue(bundle["passed"])
        self.assertEqual(bundle["profile"], "default")
        self.assertIn("issued_at", bundle)

    def test_certify_failing_run(self):
        certifier = ComplianceCertifier()
        results = [{"check": "a", "passed": True}, {"check": "b", "passed": False}]
        bundle = certifier.certify("run-1", "default", results)
        self.assertFalse(bundle["passed"])

    def test_verify_bundle_with_signature(self):
        certifier = ComplianceCertifier({"namespace": "root-1"})
        results = [{"check": "a", "passed": True}]
        bundle = certifier.certify("run-1", "default", results)
        self.assertIn("signature", bundle)
        self.assertTrue(certifier.verify_bundle(bundle))

    def test_verify_bundle_rejects_tampered(self):
        certifier = ComplianceCertifier({"namespace": "root-1"})
        results = [{"check": "a", "passed": True}]
        bundle = certifier.certify("run-1", "default", results)
        bundle["profile"] = "other"
        self.assertFalse(certifier.verify_bundle(bundle))
