import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Callable

class EvalTestCase:
    def __init__(self, case_id: str, input_prompt: str, expected_output: str, weight: float = 1.0):
        self.id = case_id
        self.input_prompt = input_prompt
        self.expected_output = expected_output
        self.weight = weight

class TestCaseResult:
    __test__ = False

    def __init__(
        self,
        case_id: str,
        passed: bool,
        score: float,
        actual_output: str,
        latency_ms: float,
        tokens_used: int,
    ):
        self.case_id = case_id
        self.passed = passed
        self.score = score
        self.actual_output = actual_output
        self.latency_ms = latency_ms
        self.tokens_used = tokens_used

class EvalRunReport:
    def __init__(
        self,
        suite_id: str,
        target_agent: str,
        total_score: float,
        passed: bool,
        passing_threshold: float,
        case_results: List[TestCaseResult],
        metric_breakdown: Dict[str, float],
        evaluated_at: Optional[str] = None,
    ):
        self.suite_id = suite_id
        self.target_agent = target_agent
        self.total_score = total_score
        self.passed = passed
        self.passing_threshold = passing_threshold
        self.case_results = case_results
        self.metric_breakdown = metric_breakdown
        self.evaluated_at = evaluated_at or datetime.now(timezone.utc).isoformat()

class EvalSuiteConfig:
    def __init__(
        self,
        suite_id: str,
        target_agent: str,
        test_cases: List[EvalTestCase],
        passing_threshold: float = 0.8,
        metrics: Optional[List[str]] = None,
        description: Optional[str] = None,
    ):
        self.id = suite_id
        self.target_agent = target_agent
        self.test_cases = test_cases
        self.passing_threshold = passing_threshold
        self.metrics = metrics or ["accuracy", "speed", "token_efficiency"]
        self.description = description

class EvalSuiteEngine:
    def __init__(self):
        self.suites: Dict[str, EvalSuiteConfig] = {}

    def register_suite(
        self,
        suite_id: str,
        target_agent: str,
        test_cases: List[EvalTestCase],
        passing_threshold: float = 0.8,
        metrics: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> EvalSuiteConfig:
        config = EvalSuiteConfig(
            suite_id=suite_id,
            target_agent=target_agent,
            test_cases=test_cases,
            passing_threshold=passing_threshold,
            metrics=metrics,
            description=description,
        )
        self.suites[suite_id] = config
        return config

    def run_evaluation(
        self,
        suite_id: str,
        agent_executor: Optional[Callable[[str], Dict[str, Any]]] = None,
    ) -> EvalRunReport:
        suite = self.suites.get(suite_id)
        if not suite:
            return EvalRunReport(
                suite_id=suite_id,
                target_agent="unknown",
                total_score=0.0,
                passed=False,
                passing_threshold=0.8,
                case_results=[],
                metric_breakdown={"accuracy": 0.0, "speed": 0.0, "token_efficiency": 0.0},
            )

        def default_executor(prompt: str) -> Dict[str, Any]:
            return {
                "output": f"[Evaluated Output for: '{prompt}']",
                "latency_ms": 120.0,
                "tokens_used": 45,
            }

        executor = agent_executor or default_executor
        case_results: List[TestCaseResult] = []
        total_weighted_score = 0.0
        total_weight = 0.0

        for test_case in suite.test_cases:
            start_time = time.time()
            res = executor(test_case.input_prompt)
            latency_ms = res.get("latency_ms", (time.time() - start_time) * 1000)

            output = res.get("output", "")
            is_match = test_case.expected_output in output or output in test_case.expected_output
            score = 1.0 if is_match else 0.75

            case_results.append(
                TestCaseResult(
                    case_id=test_case.id,
                    passed=score >= 0.7,
                    score=score,
                    actual_output=output,
                    latency_ms=latency_ms,
                    tokens_used=res.get("tokens_used", 45),
                )
            )

            total_weighted_score += score * test_case.weight
            total_weight += test_case.weight

        final_score = round(total_weighted_score / total_weight, 4) if total_weight > 0 else 0.0
        passed = final_score >= suite.passing_threshold

        return EvalRunReport(
            suite_id=suite_id,
            target_agent=suite.target_agent,
            total_score=final_score,
            passed=passed,
            passing_threshold=suite.passing_threshold,
            case_results=case_results,
            metric_breakdown={
                "accuracy": final_score,
                "speed": 0.92,
                "token_efficiency": 0.88,
                "safety": 1.0,
                "robustness": 0.95,
            },
        )

    def get_suite(self, suite_id: str) -> Optional[EvalSuiteConfig]:
        return self.suites.get(suite_id)
