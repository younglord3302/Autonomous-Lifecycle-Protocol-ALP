import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.trace import TraceEntry, TraceStore, MerkleTree, verify_trace_integrity, trace_path


class TestMerkleTree(unittest.TestCase):
    def test_empty(self):
        self.assertIsNone(MerkleTree([]).root)

    def test_single_leaf(self):
        tree = MerkleTree(["abc"])
        self.assertEqual(tree.root, hashlib_hex("abc"))

    def test_two_leaves(self):
        left = "a"
        right = "b"
        left_hash = hashlib_hex(left)
        right_hash = hashlib_hex(right)
        expected = hashlib_hex(left_hash + right_hash)
        tree = MerkleTree([left, right])
        self.assertEqual(tree.root, expected)

    def test_four_leaves(self):
        leaves = ["1", "2", "3", "4"]
        tree = MerkleTree(leaves)
        self.assertIsNotNone(tree.root)
        self.assertEqual(len(tree.root), 64)

    def test_odd_count_pairs_last_with_itself(self):
        tree = MerkleTree(["1", "2", "3"])
        self.assertIsNotNone(tree.root)


def hashlib_hex(data: str) -> str:
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()


class TestTraceEntry(unittest.TestCase):
    def test_entry_hash_deterministic(self):
        entry = TraceEntry(
            trace_id="t1",
            event_id="e1",
            timestamp="2026-01-01T00:00:00Z",
            event_type="task_status",
            payload={"status": "[x]"},
            parent_hash="genesis",
        )
        h1 = entry.entry_hash()
        h2 = entry.entry_hash()
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)

    def test_payload_hash_excluded_from_entry_hash(self):
        e1 = TraceEntry("t", "e1", "2026-01-01T00:00:00Z", "task_status", {"status": "[x]"}, "genesis")
        e2 = TraceEntry("t", "e1", "2026-01-01T00:00:00Z", "task_status", {"status": "[!]"}, "genesis")
        self.assertNotEqual(e1._hash_payload(), e2._hash_payload())
        self.assertNotEqual(e1.entry_hash(), e2.entry_hash())

    def test_round_trip(self):
        entry = TraceEntry("t1", "e1", "2026-01-01T00:00:00Z", "task_status", {"a": 1}, "genesis", "root123")
        d = entry.to_dict()
        restored = TraceEntry.from_dict(d)
        self.assertEqual(restored.trace_id, entry.trace_id)
        self.assertEqual(restored.merkle_root, entry.merkle_root)


class TestTraceStore(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.store = TraceStore(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_append_creates_file(self):
        entry = self.store.append("run_start", {"agent": "a1"}, trace_id="trace-1")
        self.assertTrue(os.path.exists(trace_path(self.tmpdir)))
        self.assertEqual(entry.trace_id, "trace-1")
        self.assertEqual(entry.parent_hash, "genesis")
        self.assertIsNotNone(entry.merkle_root)

    def test_second_event_links_to_first(self):
        e1 = self.store.append("run_start", {"agent": "a1"}, trace_id="trace-1")
        e2 = self.store.append("task_status", {"status": "[x]"}, trace_id="trace-1")
        self.assertEqual(e2.parent_hash, e1.entry_hash())
        self.assertIsNotNone(e2.merkle_root)

    def test_read_all_returns_entries(self):
        self.store.append("run_start", trace_id="trace-1")
        self.store.append("task_status", trace_id="trace-1")
        entries = self.store.read_all("trace-1")
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].event_type, "run_start")
        self.assertEqual(entries[1].event_type, "task_status")

    def test_read_all_filters_by_trace_id(self):
        self.store.append("run_start", trace_id="trace-1")
        self.store.append("run_start", trace_id="trace-2")
        entries = self.store.read_all("trace-1")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].trace_id, "trace-1")

    def test_verify_valid_trace(self):
        self.store.append("run_start", trace_id="trace-1")
        self.store.append("task_status", trace_id="trace-1")
        result = self.store.verify_trace_integrity("trace-1")
        self.assertTrue(result["valid"])
        self.assertEqual(result["events"], 2)
        self.assertIsNotNone(result.get("merkle_root"))

    def test_verify_empty_trace_not_found(self):
        result = self.store.verify_trace_integrity("missing")
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], "trace_not_found")

    def test_tamper_breaks_integrity(self):
        import json
        entry = self.store.append("run_start", trace_id="trace-1")
        path = trace_path(self.tmpdir)
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        tampered = json.loads(lines[0])
        tampered["payload"] = {"tampered": True}
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(tampered) + "\n")
            f.writelines(lines[1:])
        result = self.store.verify_trace_integrity("trace-1")
        self.assertFalse(result["valid"])
