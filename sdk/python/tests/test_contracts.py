import os
import sys
import unittest
from typing import Any, Dict

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import AlpObject, ContractEngine, ContractResult, ContractViolation


def make_contract(pid: str, **props: Any) -> AlpObject:
    d: Dict[str, Any] = {"_type": "contract", "id": pid}
    d.update(props)
    return AlpObject.from_dict(d)


class TestContractEngine(unittest.TestCase):
    def setUp(self):
        pass

    def test_allows_operation_in_allowlist(self):
        engine = ContractEngine([
            make_contract("c1", from_="-> a", to="-> b", allows=["api.v1.users.read", "api.v1.orders.read"]),
        ])
        result = engine.check("c1", {"operation": "api.v1.users.read"})
        self.assertTrue(result.ok)

    def test_denies_operation_in_denylist(self):
        engine = ContractEngine([
            make_contract("c1", from_="-> a", to="-> b", denies=["api.v1.admin.*"]),
        ])
        result = engine.check("c1", {"operation": "api.v1.admin.secrets"})
        self.assertFalse(result.ok)
        self.assertEqual(result.violation.reason, "denied")

    def test_blocks_non_allowlisted_when_allows_nonempty(self):
        engine = ContractEngine([
            make_contract("c1", from_="-> a", to="-> b", allows=["api.v1.users.read"]),
        ])
        result = engine.check("c1", {"operation": "api.v2.metrics.write"})
        self.assertFalse(result.ok)
        self.assertEqual(result.violation.reason, "not in allow-list")

    def test_requires_condition_not_met(self):
        engine = ContractEngine([
            make_contract("c-auth", from_="-> a", to="-> b", requires=["auth.token valid"], allows=["any"]),
        ])
        missing = engine.check("c-auth", {"operation": "any", "auth": {}})
        self.assertFalse(missing.ok)
        self.assertEqual(missing.violation.reason, "required condition not met")
        present = engine.check("c-auth", {"operation": "any", "auth": {"token": "valid"}})
        self.assertTrue(present.ok)

    def test_requires_numeric_condition(self):
        engine = ContractEngine([
            make_contract("c-rate", from_="-> a", to="-> b", requires=["rate_limit < 100"], allows=["any"]),
        ])
        self.assertTrue(engine.check("c-rate", {"operation": "any", "rate_limit": 50}).ok)
        self.assertFalse(engine.check("c-rate", {"operation": "any", "rate_limit": 200}).ok)

    def test_unknown_contract_id(self):
        engine = ContractEngine([make_contract("c1", from_="-> a", to="-> b")])
        result = engine.check("does-not-exist", {"operation": "any"})
        self.assertFalse(result.ok)
        self.assertEqual(result.violation.rule, "")

    def test_warn_mode_allows_operation(self):
        engine = ContractEngine([
            make_contract("c-warn", from_="-> a", to="-> b", denies=["bad.op"], on_violation="warn"),
        ])
        result = engine.check("c-warn", {"operation": "bad.op"})
        self.assertTrue(result.ok)

    def test_glob_deny_pattern(self):
        engine = ContractEngine([
            make_contract("c1", from_="-> a", to="-> b", denies=["api.v1.admin.*"]),
        ])
        self.assertFalse(engine.check("c1", {"operation": "api.v1.admin.config"}).ok)
        self.assertTrue(engine.check("c1", {"operation": "api.v1.users.read"}).ok)

    def test_list_returns_all_contracts(self):
        engine = ContractEngine([
            make_contract("c1", from_="-> a", to="-> b"),
            make_contract("c2", from_="-> c", to="-> d"),
        ])
        ids = [c.id for c in engine.list()]
        self.assertEqual(ids, ["c1", "c2"])


if __name__ == "__main__":
    unittest.main()
