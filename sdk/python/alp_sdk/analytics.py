"""ALP State Store analytics (v4 — The Federation Era, Pillar 5).

Mirrors parser/src/state-store.ts: a dependency-free analytics computation
over runtime events. Kept pure (no I/O) so it runs against a raw JSONL tail
or a persisted snapshot interchangeably.
"""

from typing import Any, Dict, List, Optional


def _key(e: Dict[str, Any]) -> str:
    return "|".join([
        str(e.get("timestamp", "")),
        str(e.get("type", "")),
        str(e.get("task_id", "")),
        str(e.get("status", "")),
        str(e.get("agent", "")),
    ])


def compute_analytics(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    event_counts: Dict[str, int] = {}
    task_map: Dict[str, Dict[str, Any]] = {}
    agent_map: Dict[str, Dict[str, int]] = {}
    runs = 0

    def get_task(tid: str) -> Dict[str, Any]:
        t = task_map.get(tid)
        if t is None:
            t = {
                "task_id": tid,
                "claims": 0,
                "failures": 0,
                "handoffs": 0,
                "completed": False,
                "cycle_time_ms": None,
                "first_claim": None,
                "first_done": None,
            }
            task_map[tid] = t
        return t

    def get_agent(aid: str) -> Dict[str, int]:
        a = agent_map.get(aid)
        if a is None:
            a = {"agent": aid, "claims": 0, "completions": 0, "failures": 0}
            agent_map[aid] = a
        return a

    for e in events:
        etype = e.get("type", "")
        event_counts[etype] = event_counts.get(etype, 0) + 1
        if etype == "run_start":
            runs += 1

        ts = _parse_ts(e.get("timestamp"))
        tid = e.get("task_id") or e.get("task_id")
        if isinstance(tid, str) and not tid:
            tid = None
        agent = e.get("agent")

        if etype == "task_claim" and tid:
            t = get_task(tid)
            t["claims"] += 1
            if t["first_claim"] is None and ts is not None:
                t["first_claim"] = ts
            if agent:
                get_agent(agent)["claims"] += 1

        if etype == "task_status" and tid:
            t = get_task(tid)
            status = e.get("status")
            if status == "[x]":
                t["completed"] = True
                if t["first_done"] is None and ts is not None:
                    t["first_done"] = ts
                if agent:
                    get_agent(agent)["completions"] += 1
            elif status == "[!]":
                t["failures"] += 1
                if agent:
                    get_agent(agent)["failures"] += 1

        if etype == "workflow_fail" and tid:
            get_task(tid)["failures"] += 1

        if (etype == "human_handoff" or e.get("status") == "[?]") and tid:
            get_task(tid)["handoffs"] += 1

    tasks: List[Dict[str, Any]] = []
    cycle_times: List[int] = []
    for t in task_map.values():
        fc, fd = t["first_claim"], t["first_done"]
        if fc is not None and fd is not None and fd >= fc:
            t["cycle_time_ms"] = fd - fc
            cycle_times.append(t["cycle_time_ms"])
        tasks.append({
            "task_id": t["task_id"],
            "claims": t["claims"],
            "failures": t["failures"],
            "handoffs": t["handoffs"],
            "completed": t["completed"],
            "cycle_time_ms": t["cycle_time_ms"],
        })

    failure_hotspots = sorted(
        [
            {"task_id": t["task_id"], "failures": t["failures"], "handoffs": t["handoffs"]}
            for t in tasks
            if t["failures"] > 0 or t["handoffs"] > 0
        ],
        key=lambda h: (-h["failures"], -h["handoffs"]),
    )

    avg_cycle = int(sum(cycle_times) / len(cycle_times)) if cycle_times else None

    return {
        "total_events": len(events),
        "event_counts": event_counts,
        "runs": runs,
        "tasks": sorted(tasks, key=lambda x: x["task_id"]),
        "agents": sorted(
            [{"agent": a["agent"], "claims": a["claims"], "completions": a["completions"], "failures": a["failures"]}
             for a in agent_map.values()],
            key=lambda x: x["agent"],
        ),
        "failure_hotspots": failure_hotspots,
        "avg_cycle_time_ms": avg_cycle,
        "first_event": events[0]["timestamp"] if events else None,
        "last_event": events[-1]["timestamp"] if events else None,
    }


def _parse_ts(ts: Optional[str]) -> Optional[int]:
    if not ts:
        return None
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None
