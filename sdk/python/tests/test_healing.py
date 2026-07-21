import json
import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.healing import (
    HEALING_DIR,
    HEALING_FILE,
    CircuitBreaker,
    HealingAction,
    HealingContext,
    HealingEngine,
    HealingReport,
    HealingStrategy,
)


class TestHealingStrategy(unittest.TestCase):
    def test_values(self):
        self.assertEqual(HealingStrategy.RETRY, "retry")
        self.assertEqual(HealingStrategy.SKIP, "skip")
        self.assertEqual(HealingStrategy.ROLLBACK, "rollback")
        self.assertEqual(HealingStrategy.ESCALATE, "escalate")


class TestHealingAction(unittest.TestCase):
    def test_to_dict_round_trip(self):
        action = HealingAction(
            strategy="retry",
            task_id="t1",
            workflow_id="wf1",
            attempt=2,
            reason="Retry succeeded",
            succeeded=True,
            timestamp="2026-01-01T00:00:00Z",
        )
        d = action.to_dict()
        self.assertEqual(d["strategy"], "retry")
        self.assertEqual(d["task_id"], "t1")
        self.assertEqual(d["attempt"], 2)
        self.assertTrue(d["succeeded"])


class TestHealingReport(unittest.TestCase):
    def test_add_action_and_summary(self):
        report = HealingReport(workflow_id="wf1")
        report.add_action(HealingAction("retry", "t1", "wf1", 1, "ok", True))
        report.add_action(HealingAction("skip", "t2", "wf1", 1, "skipped", True))
        report.finished_at = "2026-01-01T00:00:01Z"
        d = report.to_dict()
        self.assertEqual(d["total_actions"], 2)
        self.assertEqual(d["succeeded"], 2)
        self.assertEqual(d["failed"], 0)
        s = report.summary()
        self.assertIn("wf1", s)
        self.assertIn("actions=2", s)

    def test_empty_report(self):
        report = HealingReport(workflow_id="wf1")
        d = report.to_dict()
        self.assertEqual(d["total_actions"], 0)
        self.assertEqual(d["succeeded"], 0)
        self.assertEqual(d["failed"], 0)


class TestCircuitBreaker(unittest.TestCase):
    def test_closed_initially(self):
        cb = CircuitBreaker(failure_threshold=2)
        self.assertFalse(cb.is_open("t1"))

    def test_opens_after_threshold(self):
        cb = CircuitBreaker(failure_threshold=2)
        cb.record_failure("t1")
        self.assertFalse(cb.is_open("t1"))
        cb.record_failure("t1")
        self.assertTrue(cb.is_open("t1"))

    def test_success_resets(self):
        cb = CircuitBreaker(failure_threshold=2)
        cb.record_failure("t1")
        cb.record_success("t1")
        self.assertFalse(cb.is_open("t1"))

    def test_reset_clears(self):
        cb = CircuitBreaker(failure_threshold=2)
        cb.record_failure("t1")
        cb.record_failure("t1")
        self.assertTrue(cb.is_open("t1"))
        cb.reset("t1")
        self.assertFalse(cb.is_open("t1"))

    def test_recovery_timeout(self):
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.01)
        cb.record_failure("t1")
        cb.record_failure("t1")
        self.assertTrue(cb.is_open("t1"))
        import time
        time.sleep(0.02)
        self.assertFalse(cb.is_open("t1"))


class TestHealingEngine(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.engine = HealingEngine(self.tmpdir, max_attempts=2)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_retry_succeeds(self):
        def executor(ctx):
            return "ok"

        report = self.engine.heal("t1", "transient", attempt=1, executor=executor)
        self.assertEqual(len(report.actions), 1)
        self.assertEqual(report.actions[0].strategy, "retry")
        self.assertTrue(report.actions[0].succeeded)
        self.assertEqual(report.actions[0].reason, "Retry succeeded")

    def test_retry_fails_escalates(self):
        def executor(ctx):
            raise RuntimeError("always fails")

        report = self.engine.heal("t1", "always fails", attempt=1, executor=executor)
        self.assertEqual(report.actions[0].strategy, "retry")
        self.assertFalse(report.actions[0].succeeded)
        report = self.engine.heal("t1", "always fails", attempt=2, executor=executor)
        self.assertEqual(report.actions[1].strategy, "escalate")
        self.assertFalse(report.actions[1].succeeded)
        self.assertIn("max attempts", report.actions[1].reason)

    def test_skip_non_retryable(self):
        def executor(ctx):
            raise RuntimeError("should not run")

        report = self.engine.heal("t1", "cannot retry: bad input", attempt=1, executor=executor)
        self.assertEqual(report.actions[0].strategy, "skip")
        self.assertTrue(report.actions[0].succeeded)
        self.assertIn("Skipped", report.actions[0].reason)

    def test_circuit_breaker_triggers_escalate(self):
        cb = CircuitBreaker(failure_threshold=1)
        engine = HealingEngine(self.tmpdir, circuit_breaker=cb, max_attempts=5)

        def executor(ctx):
            raise RuntimeError("fail")

        engine.heal("t1", "fail", attempt=1, executor=executor)
        report = engine.heal("t1", "fail", attempt=2, executor=executor)
        self.assertEqual(report.actions[1].strategy, "escalate")
        self.assertIn("circuit breaker", report.actions[1].reason)

    def test_rollback_when_checkpoint_present(self):
        engine = HealingEngine(self.tmpdir, max_attempts=3)

        def executor(ctx):
            if ctx.metadata.get("checkpoint") and ctx.attempt > 1:
                return "recovered"
            raise RuntimeError("fail")

        report = engine.heal(
            "t1",
            "fail",
            attempt=1,
            executor=executor,
            context={"checkpoint": True},
        )
        self.assertEqual(report.actions[0].strategy, "retry")
        self.assertFalse(report.actions[0].succeeded)
        report = engine.heal(
            "t1",
            "fail",
            attempt=2,
            executor=executor,
            context={"checkpoint": True},
        )
        self.assertEqual(report.actions[1].strategy, "rollback")
        self.assertTrue(report.actions[1].succeeded)

    def test_persists_actions_to_file(self):
        def executor(ctx):
            raise RuntimeError("fail")

        self.engine.heal("t1", "fail", attempt=1, executor=executor)
        path = os.path.join(self.tmpdir, HEALING_DIR, HEALING_FILE)
        self.assertTrue(os.path.exists(path))
        with open(path, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
        self.assertEqual(len(lines), 1)
        parsed = json.loads(lines[0])
        self.assertEqual(parsed["task_id"], "t1")
        self.assertEqual(parsed["strategy"], "retry")

    def test_get_report(self):
        report = self.engine.get_report("nonexistent")
        self.assertIsNone(report)
        r = self.engine.heal("t1", "fail", attempt=1, executor=lambda ctx: None)
        fetched = self.engine.get_report("_global")
        self.assertIsNotNone(fetched)
        self.assertEqual(len(fetched.actions), 1)

    def test_read_past_actions_filters(self):
        def executor(ctx):
            raise RuntimeError("fail")

        self.engine.heal("t1", "fail", attempt=1, executor=executor, workflow_id="wf1")
        self.engine.heal("t2", "fail", attempt=1, executor=executor, workflow_id="wf2")
        actions = self.engine.read_past_actions("wf1")
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]["task_id"], "t1")
        all_actions = self.engine.read_past_actions()
        self.assertEqual(len(all_actions), 2)


if __name__ == "__main__":
    unittest.main()
