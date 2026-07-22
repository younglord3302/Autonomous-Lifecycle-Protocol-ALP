import unittest
from alp_sdk.eval_suite import (
    EvalSuiteEngine,
    EvalSuiteConfig,
    EvalTestCase,
    TestCaseResult,
    EvalRunReport,
)

class TestEvalSuiteConfig(unittest.TestCase):
    def test_default_values(self):
        config = EvalSuiteConfig(
            suite_id="s1",
            target_agent="agent-x",
            test_cases=[EvalTestCase("c1", "hello", "world")],
        )
        self.assertEqual(config.id, "s1")
        self.assertEqual(config.targetAgent if hasattr(config, 'targetAgent') else config.target_agent, "agent-x")
        self.assertEqual(config.passing_threshold, 0.8)
        self.assertEqual(len(config.test_cases), 1)

class TestEvalSuiteEngine(unittest.TestCase):
    def test_register_and_run_evaluation(self):
        engine = EvalSuiteEngine()
        config = engine.register_suite(
            suite_id="suite-bench",
            target_agent="agent-pro",
            test_cases=[
                EvalTestCase("tc-1", "generate test", "test", weight=1.0),
                EvalTestCase("tc-2", "refactor code", "code", weight=2.0),
            ],
            passing_threshold=0.75,
        )

        self.assertEqual(config.id, "suite-bench")
        report = engine.run_evaluation("suite-bench")
        self.assertIsInstance(report, EvalRunReport)
        self.assertTrue(report.passed)
        self.assertGreaterEqual(report.total_score, 0.75)
        self.assertEqual(len(report.case_results), 2)

    def test_custom_executor(self):
        engine = EvalSuiteEngine()
        engine.register_suite(
            suite_id="suite-fast",
            target_agent="agent-flash",
            test_cases=[EvalTestCase("t1", "ping", "pong")],
        )

        def custom_exec(prompt: str):
            return {"output": "pong", "latency_ms": 10.0, "tokens_used": 5}

        report = engine.run_evaluation("suite-fast", custom_exec)
        self.assertEqual(report.total_score, 1.0)
        self.assertTrue(report.passed)
        self.assertEqual(report.case_results[0].latency_ms, 10.0)

    def test_unknown_suite_returns_failed_report(self):
        engine = EvalSuiteEngine()
        report = engine.run_evaluation("non-existent")
        self.assertFalse(report.passed)
        self.assertEqual(report.total_score, 0.0)
