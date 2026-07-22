import unittest
from alp_sdk.formal_verification import FormalVerificationEngine, Transition

class TestFormalVerification(unittest.TestCase):
    def test_deadlock_detection(self):
        engine = FormalVerificationEngine()
        states = ["s1", "s2"]
        transitions = [Transition("s1", "s2")]
        res = engine.check_safety_invariants(states, transitions, terminal_states=[])
        self.assertFalse(res["is_safe"])
        self.assertIn("s2", res["deadlocks"])

    def test_tla_spec_and_verification(self):
        engine = FormalVerificationEngine()
        states = ["init", "done"]
        transitions = [Transition("init", "done")]
        receipt = engine.verify_spec("TestSpec", states, transitions, terminal_states=["done"])

        self.assertTrue(receipt.deadlock_free)
        self.assertEqual(receipt.target_spec, "TestSpec")
        self.assertTrue(len(receipt.tla_spec_hash) > 0)

if __name__ == "__main__":
    unittest.main()
