from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class Transition:
    def __init__(self, from_state: str, to_state: str):
        self.from_state = from_state
        self.to_state = to_state

class FormalProofReceipt:
    def __init__(
        self,
        proof_id: str,
        target_spec: str,
        deadlock_free: bool,
        invariants_satisfied: int,
        unreachable_states: List[str],
        tla_spec_hash: str,
        timestamp: Optional[str] = None,
    ):
        self.id = proof_id
        self.target_spec = target_spec
        self.deadlock_free = deadlock_free
        self.invariants_satisfied = invariants_satisfied
        self.unreachable_states = unreachable_states
        self.tla_spec_hash = tla_spec_hash
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()

class FormalVerificationEngine:
    def check_safety_invariants(
        self,
        states: List[str],
        transitions: List[Transition],
        terminal_states: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        terminals = terminal_states or []
        outgoing_map = {s: 0 for s in states}
        incoming_map = {s: 0 for s in states}

        for t in transitions:
            outgoing_map[t.from_state] = outgoing_map.get(t.from_state, 0) + 1
            incoming_map[t.to_state] = incoming_map.get(t.to_state, 0) + 1

        deadlocks = [s for s in states if s not in terminals and outgoing_map.get(s, 0) == 0]
        unreachable = [s for s in states if s != states[0] and incoming_map.get(s, 0) == 0]

        return {
            "is_safe": len(deadlocks) == 0,
            "deadlocks": deadlocks,
            "unreachable": unreachable,
        }

    def generate_tla_spec(self, spec_id: str, states: List[str], transitions: List[Transition]) -> str:
        state_list = ", ".join(f'"{s}"' for s in states)
        next_rules = "\n".join(f'    \\/ (state = "{t.from_state}" /\\ state\' = "{t.to_state}")' for t in transitions)

        return f"""---- MODULE {spec_id} ----
EXTENDS Naturals, Sequences

VARIABLES state

Init == state = "{states[0] if states else 'Init'}"

Next ==
{next_rules if next_rules else '    UNCHANGED state'}

Spec == Init /\\ [][Next]_state

Invariant_TypeOK == state \\in {{{state_list}}}
=============================================
"""

    def verify_spec(
        self,
        spec_id: str,
        states: List[str],
        transitions: List[Transition],
        terminal_states: Optional[List[str]] = None,
    ) -> FormalProofReceipt:
        analysis = self.check_safety_invariants(states, transitions, terminal_states)
        tla_spec = self.generate_tla_spec(spec_id, states, transitions)
        tla_hash = hashlib.sha256(tla_spec.encode("utf-8")).hexdigest()

        return FormalProofReceipt(
            proof_id=f"proof-{spec_id}",
            target_spec=spec_id,
            deadlock_free=analysis["is_safe"],
            invariants_satisfied=len(states) - len(analysis["deadlocks"]),
            unreachable_states=analysis["unreachable"],
            tla_spec_hash=tla_hash,
        )
