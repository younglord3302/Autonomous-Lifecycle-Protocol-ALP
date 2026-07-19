"""ALP timeline engine (v8.2.0 - Python SDK parity).

Mirrors the TypeScript ``TimelineEngine``: evaluates ``@timeline`` objects
against a reference time and returns the set of tasks that are due.
Supports standard 5-field cron expressions and one-shot ISO 8601 ``at``
triggers.
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from .models import AlpObject


class TimelineResult:
    def __init__(self, timeline: AlpObject, task: str, agent: Optional[str], reason: str):
        self.timeline = timeline
        self.task = task
        self.agent = agent
        self.reason = reason

    def __repr__(self) -> str:
        return f"TimelineResult(task={self.task!r}, reason={self.reason!r})"


MONTH_NAMES = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}
DOW_NAMES = {
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
}


def _parse_field(field: str, lo: int, hi: int):
    values = []
    for segment in field.split(','):
        segment = segment.strip()
        if segment == '*':
            for v in range(lo, hi + 1):
                if v not in values:
                    values.append(v)
            continue
        step_match = re.match(r'^(.+)/(\d+)$', segment)
        if step_match:
            range_start = _parse_range(step_match.group(1), lo, hi)
            range_end = hi
            step = int(step_match.group(2))
        else:
            range_start = _parse_range(segment, lo, hi)
            range_end = range_start
            step = 1
        for v in range(range_start, range_end + 1, step):
            if v not in values:
                values.append(v)
    return values


def _parse_range(segment: str, lo: int, hi: int) -> int:
    segment = segment.strip().lower()
    if segment == '*':
        return lo
    m = re.match(r'^(\w+)(?:-(\w+))?$', segment)
    if not m:
        raise ValueError(f"Invalid cron field: {segment!r}")
    start = _resolve_name(m.group(1), lo, hi)
    end = m.group(2) and _resolve_name(m.group(2), lo, hi) or start
    return max(lo, min(hi, start))


def _resolve_name(token: str, lo: int, hi: int) -> int:
    n = int(token) if token.isdigit() else None
    if n is not None:
        return max(lo, min(hi, n))
    mapping = MONTH_NAMES if hi == 12 else DOW_NAMES
    v = mapping.get(token)
    if v is None:
        raise ValueError(f"Unknown cron token: {token!r}")
    return v


def _field_match(value: int, field: Any) -> bool:
    if isinstance(field, list):
        return value in field
    return value == field


def _parse_cron(expr: str):
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression (expected 5 fields): {expr!r}")
    minute, hour, dom, month, dow = parts
    return {
        'minute': _parse_field(minute, 0, 59),
        'hour': _parse_field(hour, 0, 23),
        'dom': _parse_field(dom, 1, 31),
        'month': _parse_field(month, 1, 12),
        'dow': _parse_field(dow, 0, 7),
    }


def _matches_cron(now: datetime, parts: Dict[str, Any]) -> bool:
    # Python weekday: Monday=0 ... Sunday=6.  Cron: Sunday=0/7, Monday=1 ... Saturday=6.
    cron_dow = 0 if now.weekday() == 6 else now.weekday() + 1
    return (
        _field_match(now.minute, parts['minute'])
        and _field_match(now.hour, parts['hour'])
        and _field_match(now.day, parts['dom'])
        and _field_match(now.month, parts['month'])
        and _field_match(cron_dow, parts['dow'])
    )


class TimelineEngine:
    """Evaluate ``@timeline`` objects against a reference time."""

    def __init__(self, objects: List[AlpObject]):
        self.timelines: List[AlpObject] = [o for o in objects if o._type == 'timeline']

    @property
    def count(self) -> int:
        return len(self.timelines)

    def evaluate(self, now: Optional[datetime] = None) -> List[TimelineResult]:
        """Return the set of tasks that are due at ``now`` (default: UTC now)."""
        now = now or datetime.now(timezone.utc)
        results: List[TimelineResult] = []
        for tl in self.timelines:
            if tl.properties.get('enabled') is False or tl.properties.get('enabled') == 'false':
                continue
            cron = tl.properties.get('cron')
            at = tl.properties.get('at')
            if not cron and not at:
                continue
            if cron and isinstance(cron, str):
                try:
                    parts = _parse_cron(cron)
                    if _matches_cron(now, parts):
                        results.append(TimelineResult(tl, tl.properties.get('task', ''), tl.properties.get('agent'), 'cron'))
                except Exception:
                    pass
            elif at and isinstance(at, str):
                try:
                    fire_at = datetime.fromisoformat(at.replace('Z', '+00:00'))
                    if now >= fire_at:
                        results.append(TimelineResult(tl, tl.properties.get('task', ''), tl.properties.get('agent'), 'at'))
                except Exception:
                    pass
        return results

    def list(self) -> List[Dict[str, Any]]:
        """List all timelines with their schedule summary."""
        out = []
        for tl in self.timelines:
            out.append({
                'id': tl.properties.get('id', ''),
                'cron': tl.properties.get('cron'),
                'at': tl.properties.get('at'),
                'enabled': tl.properties.get('enabled') is not False and tl.properties.get('enabled') != 'false',
                'task': tl.properties.get('task', ''),
            })
        return out
