import os
import sys
import subprocess
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    LoopEngine,
    LoopConfig,
    LoopEvent,
    WorkflowEngine,
    RetryStrategy,
    ContextEngine,
    VerificationEngine,
    VerificationResult,
    VerificationReport,
    EngineError,
    LOOP_STAGES,
    PolicyEngine,
)


class FakeProc:
    def __init__(self, returncode, stdout=""):
        self.returncode = returncode
        self.stdout = stdout


class TestLoopEngine(unittest.TestCase):
    def test_stages_constant(self):
        self.assertEqual(
            LOOP_STAGES,
            ["understand", "plan", "implement", "test", "review", "reflect", "improve"],
        )

    def test_completes_when_condition_met(self):
        events = []
        engine = LoopEngine(LoopConfig(max_iterations=10, completion_conditions=["x"]))
        engine.on(events.append)
        calls = {"n": 0}

        def stage(stage_name, iteration):
            calls["n"] += 1
            return iteration >= 3  # complete after 3 iterations

        result = engine.run(stage)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["iterations"], 3)
        self.assertEqual(engine.status, "completed")
        self.assertEqual(engine.get_last_checkpoint().iteration, 3)
        types = [e.type for e in events]
        self.assertIn("iteration_start", types)
        self.assertIn("completed", types)
        self.assertIn("checkpoint", types)

    def test_max_iterations_failure(self):
        engine = LoopEngine(LoopConfig(max_iterations=4, completion_conditions=["x"]))

        def stage(stage_name, iteration):
            return False

        result = engine.run(stage)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["iterations"], 4)

    def test_checkpoint_disabled(self):
        engine = LoopEngine(
            LoopConfig(max_iterations=2, completion_conditions=["x"], checkpoint_per_iteration=False)
        )
        engine.run(lambda s, i: False)
        self.assertEqual(engine.checkpoints, [])
        self.assertEqual(engine.get_state()["checkpoints"], 0)

    def test_failure_emits_failed_with_rollback_strategy(self):
        events = []
        engine = LoopEngine(
            LoopConfig(
                max_iterations=5,
                completion_conditions=["x"],
                rollback_strategy="Revert to last checkpoint",
            )
        )
        engine.on(events.append)

        def stage(stage_name, iteration):
            # Succeed once (creates a checkpoint), then fail on iteration 2 so
            # the engine can roll back to the existing checkpoint.
            if iteration >= 2:
                raise RuntimeError("boom")
            return False

        result = engine.run(stage)
        self.assertEqual(result["status"], "rolled_back")
        self.assertIn("rolled_back", [e.type for e in events])

    def test_failure_without_checkpoint_is_failed(self):
        engine = LoopEngine(
            LoopConfig(
                max_iterations=5,
                completion_conditions=["x"],
                rollback_strategy="Revert to last checkpoint",
            )
        )

        def stage(stage_name, iteration):
            raise RuntimeError("boom")

        result = engine.run(stage)
        # No checkpoint exists yet, so the engine cannot roll back.
        self.assertEqual(result["status"], "failed")

    def test_get_state(self):
        engine = LoopEngine(LoopConfig(max_iterations=1, completion_conditions=["x"]))
        self.assertEqual(engine.get_state()["status"], "idle")
        engine.run(lambda s, i: True)
        state = engine.get_state()
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["iteration"], 1)


class TestWorkflowEngine(unittest.TestCase):
    def test_sequential_execution(self):
        we = WorkflowEngine("stop")
        executed = []
        steps = [
            {"name": "a"},
            {"name": "b"},
            {"name": "c"},
        ]
        results = we.execute(steps, executor=lambda s: executed.append(s["name"]))
        self.assertEqual(executed, ["a", "b", "c"])
        self.assertTrue(all(r.status == "success" for r in results))

    def test_conditional_skip(self):
        we = WorkflowEngine("stop")
        executed = []
        steps = [
            {"name": "always"},
            {"name": "maybe", "condition": "false"},
            {"name": "also", "condition": "1 == 1"},
        ]
        results = we.execute(steps, executor=lambda s: executed.append(s["name"]))
        self.assertEqual(executed, ["always", "also"])
        skipped = [r for r in results if r.status == "skipped"]
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0].name, "maybe")

    def test_failure_strategy_stop_halts(self):
        we = WorkflowEngine("stop")
        executed = []

        def boom(step):
            if step["name"] == "b":
                raise RuntimeError("fail b")
            executed.append(step["name"])

        steps = [{"name": "a"}, {"name": "b"}, {"name": "c"}]
        results = we.execute(steps, executor=boom)
        self.assertEqual(executed, ["a"])
        self.assertEqual(results[1].status, "failed")
        # c never ran
        self.assertEqual(len(results), 2)

    def test_failure_strategy_skip_continues(self):
        we = WorkflowEngine("skip")

        def boom(step):
            if step["name"] == "b":
                raise RuntimeError("fail b")
            # a, c just pass

        steps = [{"name": "a"}, {"name": "b"}, {"name": "c"}]
        results = we.execute(steps, executor=boom)
        self.assertEqual([r.status for r in results], ["success", "failed", "success"])

    def test_retry_strategy(self):
        we = WorkflowEngine("retry", RetryStrategy(max_retries=2, delay=0, backoff="fixed"))
        attempts = {"b": 0}

        def flaky(step):
            if step["name"] == "b":
                attempts["b"] += 1
                if attempts["b"] < 3:
                    raise RuntimeError("transient")
            # ok

        steps = [{"name": "a"}, {"name": "b"}]
        results = we.execute(steps, executor=flaky)
        self.assertEqual(results[1].status, "success")
        self.assertEqual(attempts["b"], 3)

    def test_retry_backoff_exponential(self):
        rs = RetryStrategy(delay=1.0, backoff="exponential", max_delay=100)
        self.assertEqual(rs.delay_for(1), 1.0)
        self.assertEqual(rs.delay_for(2), 2.0)
        self.assertEqual(rs.delay_for(3), 4.0)

    def test_invalid_failure_strategy(self):
        with self.assertRaises(EngineError):
            WorkflowEngine("explode")


class TestContextEngine(unittest.TestCase):
    def test_minimal_scope(self):
        ce = ContextEngine("minimal")
        task = {"id": "t1", "feature": "f1", "depends_on": ["t0"], "accept": ["a"]}
        ctx = ce.resolve(
            task,
            resolvers={
                "feature": lambda t: {"id": "f1"},
                "dependencies": lambda t: [{"id": "t0"}],
            },
        )
        self.assertIn("task", ctx)
        self.assertIn("accept", ctx)
        self.assertIn("feature", ctx)
        self.assertIn("dependencies", ctx)
        # minimal does not load rules/decisions
        self.assertNotIn("rules", ctx)
        self.assertNotIn("decisions", ctx)

    def test_normal_scope_loads_rules_and_decisions(self):
        ce = ContextEngine("normal")
        task = {"id": "t1", "feature": "f1"}
        ctx = ce.resolve(
            task,
            resolvers={
                "feature": lambda t: {"id": "f1"},
                "rules": lambda t: [{"id": "r1"}],
                "decisions": lambda t: [{"id": "d1"}],
            },
        )
        self.assertIn("rules", ctx)
        self.assertIn("decisions", ctx)

    def test_explicit_context_merge(self):
        ce = ContextEngine("normal")
        task = {"id": "t1", "explicit": {"extra": "value"}}
        ctx = ce.resolve(task, resolvers={"explicit": lambda t: t.get("explicit")})
        self.assertEqual(ctx["extra"], "value")

    def test_invalid_scope(self):
        with self.assertRaises(EngineError):
            ContextEngine("huge")


class TestVerificationEngine(unittest.TestCase):
    def test_required_commands_all_pass(self):
        ve = VerificationEngine()
        gates = ["true", "true"]
        report = ve.verify(gates, runner=lambda c: FakeProc(0, "ok"))
        self.assertTrue(report.passed)
        self.assertEqual(report.required_passed, 2)
        self.assertEqual(report.required_total, 2)

    def test_required_command_failure_fails_report(self):
        ve = VerificationEngine()
        gates = ["true", "false"]
        report = ve.verify(
            gates,
            runner=lambda c: FakeProc(0) if c == "true" else FakeProc(1),
        )
        self.assertFalse(report.passed)
        self.assertEqual(report.required_passed, 1)
        self.assertEqual(report.required_total, 2)

    def test_optional_failure_still_passes(self):
        ve = VerificationEngine()
        gates = [
            {"command": "true", "required": True},
            {"command": "false", "required": False},
        ]
        report = ve.verify(
            gates,
            runner=lambda c: FakeProc(0) if c == "true" else FakeProc(1),
        )
        self.assertTrue(report.passed)
        self.assertEqual(report.required_passed, 1)
        self.assertEqual(report.required_total, 1)

    def test_policy_blocks_command(self):
        policy = PolicyEngine([])

        class Decision:
            allowed = False
            blocked = True
            reasons = ["command not permitted"]

        policy.evaluate = lambda q: Decision()
        ve = VerificationEngine(policy)
        report = ve.verify(["ls"], runner=lambda c: FakeProc(0))
        self.assertFalse(report.passed)
        self.assertEqual(report.results[0].note, "Blocked by policy: command not permitted")

    def test_check_gate_via_agent(self):
        ve = VerificationEngine()
        gates = [{"check": "all good", "type": "manual", "required": True}]
        report = ve.verify(gates, agent_evaluate=lambda c: c == "all good")
        self.assertTrue(report.passed)

    def test_summary(self):
        report = VerificationReport(passed=True, results=[], required_passed=2, required_total=2)
        self.assertIn("PASS", report.summary())
        self.assertIn("2/2", report.summary())


class TestEngineIntegration(unittest.TestCase):
    def test_loop_drives_workflow_style_completion(self):
        # A loop whose execute_stage marks completion once a counter reaches 2.
        engine = LoopEngine(LoopConfig(max_iterations=5, completion_conditions=["done"]))
        state = {"iter": 0}
        result = engine.run(
            lambda stage, it: (state.__setitem__("iter", it) or it >= 2)
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["iterations"], 2)


if __name__ == "__main__":
    unittest.main()
