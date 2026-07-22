import unittest
from alp_sdk.telemetry import TelemetryEngine

class TestTelemetry(unittest.TestCase):
    def test_start_and_end_span(self):
        engine = TelemetryEngine()
        span = engine.start_span("python-test-span", agent="@agent-qa")
        self.assertIsNotNone(span.span_id)
        self.assertIsNotNone(span.trace_id)
        self.assertEqual(span.agent, "@agent-qa")

        ended = engine.end_span(span.span_id, status="OK", attributes={"key": "val"})
        self.assertIsNotNone(ended)
        self.assertEqual(ended.status, "OK")
        self.assertEqual(ended.attributes["key"], "val")

    def test_traceparent_context(self):
        engine = TelemetryEngine()
        span = engine.start_span("agent-handoff")
        ctx = engine.inject_context(span)
        self.assertTrue(ctx.startswith("00-"))

        extracted = engine.extract_context(ctx)
        self.assertIsNotNone(extracted)
        self.assertEqual(extracted["trace_id"], span.trace_id)
        self.assertEqual(extracted["parent_span_id"], span.span_id)

if __name__ == "__main__":
    unittest.main()
