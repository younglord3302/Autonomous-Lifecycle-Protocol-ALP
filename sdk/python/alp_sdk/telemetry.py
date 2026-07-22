import uuid
import time
import secrets
from typing import Optional, Dict, Any, List

class Span:
    def __init__(
        self,
        action: str,
        trace_id: Optional[str] = None,
        parent_span_id: Optional[str] = None,
        agent: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None,
    ):
        self.action = action
        self.trace_id = trace_id or secrets.token_hex(16)
        self.span_id = secrets.token_hex(8)
        self.id = f"span-{self.span_id}"
        self.parent_span_id = parent_span_id
        self.agent = agent
        self.start_time = time.time()
        self.end_time: Optional[float] = None
        self.duration_ms: Optional[float] = None
        self.status = "UNSET"
        self.attributes = attributes or {}

    def finish(self, status: str = "OK", attributes: Optional[Dict[str, Any]] = None):
        self.end_time = time.time()
        self.duration_ms = (self.end_time - self.start_time) * 1000
        self.status = status
        if attributes:
            self.attributes.update(attributes)

class TelemetryEngine:
    def __init__(self):
        self.active_spans: Dict[str, Span] = {}
        self.completed_spans: List[Span] = []

    def start_span(
        self,
        action: str,
        trace_id: Optional[str] = None,
        parent_span_id: Optional[str] = None,
        agent: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None,
    ) -> Span:
        span = Span(
            action=action,
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            agent=agent,
            attributes=attributes,
        )
        self.active_spans[span.span_id] = span
        return span

    def end_span(
        self,
        span_id: str,
        status: str = "OK",
        attributes: Optional[Dict[str, Any]] = None,
    ) -> Optional[Span]:
        span = self.active_spans.pop(span_id, None)
        if not span:
            return None
        span.finish(status=status, attributes=attributes)
        self.completed_spans.append(span)
        return span

    def inject_context(self, span: Span) -> str:
        return f"00-{span.trace_id}-{span.span_id}-01"

    def extract_context(self, traceparent: str) -> Optional[Dict[str, str]]:
        parts = traceparent.split("-")
        if len(parts) < 4 or parts[0] != "00":
            return None
        return {"trace_id": parts[1], "parent_span_id": parts[2]}

    def export_otlp(self) -> Dict[str, Any]:
        return {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [
                            {"key": "service.name", "value": {"stringValue": "alp-python-sdk"}},
                        ]
                    },
                    "scopeSpans": [
                        {
                            "scope": {"name": "alp_sdk.telemetry", "version": "17.0.0"},
                            "spans": [
                                {
                                    "traceId": s.trace_id,
                                    "spanId": s.span_id,
                                    "parentSpanId": s.parent_span_id or "",
                                    "name": s.action,
                                    "status": {"code": 1 if s.status == "OK" else 2},
                                }
                                for s in self.completed_spans
                            ],
                        }
                    ],
                }
            ]
        }
