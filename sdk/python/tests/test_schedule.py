import os
import sys
import unittest
from datetime import datetime, timezone

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import AlpObject, TimelineEngine, TimelineResult


def tl(pid, **props):
    d = {"_type": "timeline", "id": pid}
    d.update(props)
    return AlpObject.from_dict(d)


class TestTimelineEngine(unittest.TestCase):
    def test_cron_fires_at_scheduled_minute(self):
        engine = TimelineEngine([
            tl("tl-morning", cron="0 9 * * 1-5", task="-> task-standup"),
        ])
        mon = datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc)  # Monday
        results = engine.evaluate(mon)
        self.assertEqual([r.task for r in results], ["-> task-standup"])

    def test_cron_skips_outside_window(self):
        engine = TimelineEngine([
            tl("tl-morning", cron="0 9 * * 1-5", task="-> task-standup"),
        ])
        sat = datetime(2026, 7, 25, 9, 0, tzinfo=timezone.utc)  # Saturday
        self.assertEqual(engine.evaluate(sat), [])

    def test_at_fires_after_trigger(self):
        engine = TimelineEngine([
            tl("tl-once", at="2026-08-01T09:00:00Z", task="-> task-q3"),
        ])
        after = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        results = engine.evaluate(after)
        self.assertEqual([r.task for r in results], ["-> task-q3"])
        self.assertEqual(results[0].reason, "at")

    def test_at_skips_before_trigger(self):
        engine = TimelineEngine([
            tl("tl-once", at="2026-08-01T09:00:00Z", task="-> task-q3"),
        ])
        before = datetime(2026, 8, 1, 8, 0, tzinfo=timezone.utc)
        self.assertEqual(engine.evaluate(before), [])

    def test_disabled_is_skipped(self):
        engine = TimelineEngine([
            tl("tl-off", cron="0 9 * * *", task="-> task-a", enabled=False),
        ])
        mon = datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(engine.evaluate(mon), [])

    def test_list_returns_all(self):
        engine = TimelineEngine([
            tl("tl-1", cron="0 9 * * *", task="-> task-a"),
            tl("tl-2", at="2026-08-01T09:00:00Z", task="-> task-b"),
        ])
        items = engine.list()
        self.assertEqual(len(items), 2)
        self.assertIn("tl-1", [i["id"] for i in items])


if __name__ == "__main__":
    unittest.main()
