"""ALP Formal Verification (v10.9.0 - Python SDK parity).

Provides lightweight model-checking for ``@policy`` safety properties
and precondition checking for ``@contract`` objects.
"""
from __future__ import annotations


from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .models import AlpObject


@dataclass
class VerificationProperty:
    name: str
    passed: bool
    message: str


@dataclass
class CounterexampleTrace:
    contract_id: str
    invariant: str
    input: Dict[str, Any] = field(default_factory=dict)
    trace: List[str] = field(default_factory=list)


@dataclass
class VerificationProof:
    policy_id: str
    passed: bool
    checked_at: str = ""
    properties: List[VerificationProperty] = field(default_factory=list)
    counterexample: Optional[CounterexampleTrace] = None

    def __post_init__(self) -> None:
        if not self.checked_at:
            self.checked_at = datetime.now(timezone.utc).isoformat()


def _normalize_path(p: str) -> str:
    return p.replace("\\", "/").replace("./", "", 1)


def _normalize_path_like(p: str) -> str:
    return p.strip().lower()


def _is_satisfiable(expr: str) -> bool:
    trimmed = expr.strip()
    if not trimmed:
        return True
    if "==" in trimmed and "!=" in trimmed:
        parts = trimmed.split("==", 1)
        if len(parts) == 2:
            after = parts[1].strip()
            neq_match = after.split("!=", 1)
            if len(neq_match) == 2 and parts[0].strip() == neq_match[1].strip():
                return False
    return True


def _parse_inline_object(literal: str) -> Dict[str, Any]:
    inner = literal.strip().replace("{", "", 1).replace("}", "", 1)
    out: Dict[str, Any] = {}
    if not inner.strip():
        return out
    depth = 0
    buf = ""
    for i in range(len(inner)):
        c = inner[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth = max(0, depth - 1)
        if c == "," and depth == 0:
            _apply_pair(buf, out)
            buf = ""
        else:
            buf += c
    if buf.strip():
        _apply_pair(buf, out)
    return out


def _apply_pair(pair: str, out: Dict[str, Any]) -> None:
    idx = pair.index(":") if ":" in pair else -1
    if idx == -1:
        return
    key = pair[:idx].strip()
    value = pair[idx + 1:].strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1]
    out[key] = value


class PolicyModelChecker:
    """Lightweight model-checking for ``@policy`` safety properties."""

    def __init__(self, objects: List[AlpObject]):
        self.objects = objects

    def verify(self, policy_id: str) -> VerificationProof:
        policy = next((o for o in self.objects if o._type == "policy" and o.id == policy_id), None)
        if policy is None:
            return VerificationProof(
                policy_id=policy_id,
                passed=False,
                counterexample=CounterexampleTrace(
                    contract_id=policy_id,
                    invariant="policy_exists",
                    input={},
                    trace=[f"Policy '{policy_id}' not found in workspace."],
                ),
            )

        props = policy.properties
        applies_to = props.get("applies_to", "*")
        allow_paths = [str(p) for p in (props.get("allow_paths") or [])]
        deny_paths = [str(p) for p in (props.get("deny_paths") or [])]
        allow_commands = [str(p) for p in (props.get("allow_commands") or [])]
        deny_commands = [str(p) for p in (props.get("deny_commands") or [])]
        allow_during = props.get("allow_during") or []
        enforcement = props.get("enforcement", "strict")

        properties: List[VerificationProperty] = []

        valid_enforcement = enforcement in ("strict", "warn")
        properties.append(VerificationProperty(
            name="valid_enforcement",
            passed=valid_enforcement,
            message=f"enforcement='{enforcement}' is valid." if valid_enforcement else f"enforcement='{enforcement}' is invalid; expected 'strict' or 'warn'.",
        ))

        contradiction = any(
            _normalize_path(allow) == _normalize_path(deny)
            for deny in deny_paths
            for allow in allow_paths
        )
        properties.append(VerificationProperty(
            name="no_path_contradiction",
            passed=not contradiction,
            message="Policy allows and denies the same path." if contradiction else "No allow/deny path contradictions.",
        ))

        cmd_contradiction = any(
            allow.strip().lower() == deny.strip().lower()
            for deny in deny_commands
            for allow in allow_commands
        )
        properties.append(VerificationProperty(
            name="no_command_contradiction",
            passed=not cmd_contradiction,
            message="Policy allows and denies the same command." if cmd_contradiction else "No allow/deny command contradictions.",
        ))

        bad_window = False
        window_trace: List[str] = []
        for window in allow_during:
            w = _parse_inline_object(window) if isinstance(window, str) else window
            if not isinstance(w, dict):
                continue
            days = w.get("days") or []
            if not isinstance(days, list) or len(days) == 0:
                bad_window = True
                window_trace.append(f"Window missing days: {w!r}")
            if w.get("start") and w.get("end") and w["start"] >= w["end"]:
                bad_window = True
                window_trace.append(f"Window start >= end: {w['start']} >= {w['end']}")
        properties.append(VerificationProperty(
            name="valid_time_windows",
            passed=not bad_window,
            message=f"Invalid time window(s): {'; '.join(window_trace)}" if bad_window else "All time windows are valid.",
        ))

        valid_scope = (
            applies_to == "*"
            or applies_to == "-> *"
            or (isinstance(applies_to, list) and len(applies_to) > 0)
            or (isinstance(applies_to, str) and applies_to.startswith("->"))
        )
        properties.append(VerificationProperty(
            name="valid_scope",
            passed=valid_scope,
            message=f"Scope '{applies_to}' is valid." if valid_scope else f"Scope '{applies_to}' is invalid.",
        ))

        passed = all(p.passed for p in properties)
        proof = VerificationProof(
            policy_id=policy_id,
            passed=passed,
            properties=properties,
        )

        if not passed:
            failed = [p for p in properties if not p.passed]
            proof.counterexample = CounterexampleTrace(
                contract_id=policy_id,
                invariant=", ".join(f.name for f in failed),
                input={
                    "policy": {
                        "id": policy_id,
                        "enforcement": enforcement,
                        "allow_paths": allow_paths,
                        "deny_paths": deny_paths,
                     }
                 },
                 trace=[f.message for f in failed],
             )

        return proof


class ZKPolicyProof:
    """V10.1.0: zero-knowledge proof that a policy held for an action.

    In production this would wrap a real ZK-SNARK/STARK circuit; here we
    provide a deterministic simulation so the SDK surface is available
    without external dependencies.
    """

    def __init__(self, policy_id: str, action: str, proof_data: Optional[Dict[str, Any]] = None, verified: bool = False):
        self.policy_id = policy_id
        self.action = action
        self.proof_data = proof_data or {}
        self.verified = verified
        self.verified_at: Optional[str] = None

    def generate(self, witness: Dict[str, Any]) -> Dict[str, Any]:
        witness_hash = _sha256(witness)
        proof_payload = {
            "policy_id": self.policy_id,
            "action": self.action,
            "witness_hash": witness_hash,
        }
        expected = _sha256(proof_payload)
        self.proof_data = {
            "policy_id": self.policy_id,
            "action": self.action,
            "witness_hash": witness_hash,
            "expected": expected,
            "generated_at": _now_iso(),
        }
        return self.proof_data

    def verify(self, trust_root: Optional[Dict[str, Any]] = None) -> bool:
        if not self.proof_data or "expected" not in self.proof_data:
            return False
        proof_payload = {
            "policy_id": self.proof_data["policy_id"],
            "action": self.proof_data["action"],
            "witness_hash": self.proof_data["witness_hash"],
        }
        expected = _sha256(proof_payload)
        ok = self.proof_data.get("expected") == expected
        if trust_root:
            ok = ok and trust_root.get("namespace") in (self.proof_data.get("policy_id", ""), "*")
        self.verified = ok
        self.verified_at = _now_iso()
        return ok

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "action": self.action,
            "proof_data": self.proof_data,
            "verified": self.verified,
            "verified_at": self.verified_at,
        }


def _sha256(obj: Any) -> str:
    import hashlib, json
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class ContractInvariant:
    """Formal precondition checking for ``@contract`` objects."""

    def __init__(self, objects: List[AlpObject]):
        self.objects = objects

    def verify_contract(self, contract_id: str) -> VerificationProof:
        contract = next((o for o in self.objects if o._type == "contract" and o.id == contract_id), None)
        if contract is None:
            return VerificationProof(
                policy_id=contract_id,
                passed=False,
                counterexample=CounterexampleTrace(
                    contract_id=contract_id,
                    invariant="contract_exists",
                    input={},
                    trace=[f"Contract '{contract_id}' not found in workspace."],
                ),
            )

        props = contract.properties
        requires = [str(r) for r in (props.get("requires") or [])]
        allows = [str(a) for a in (props.get("allows") or [])]
        denies = [str(d) for d in (props.get("denies") or [])]
        ctype = props.get("type", "api")
        on_violation = props.get("on_violation", "deny")

        properties: List[VerificationProperty] = []

        valid_on_violation = on_violation in ("deny", "warn", "log")
        properties.append(VerificationProperty(
            name="valid_on_violation",
            passed=valid_on_violation,
            message=f"on_violation='{on_violation}' is valid." if valid_on_violation else f"on_violation='{on_violation}' is invalid.",
        ))

        valid_type = ctype in ("api", "data", "tool", "repo")
        properties.append(VerificationProperty(
            name="valid_type",
            passed=valid_type,
            message=f"type='{ctype}' is valid." if valid_type else f"type='{ctype}' is invalid.",
        ))

        unsatisfiable = False
        req_trace: List[str] = []
        for req in requires:
            if not _is_satisfiable(req):
                unsatisfiable = True
                req_trace.append(f"Requires condition '{req}' appears unsatisfiable.")
        properties.append(VerificationProperty(
            name="satisfiable_requires",
            passed=not unsatisfiable,
            message=f"Unsatisfiable requires: {'; '.join(req_trace)}" if unsatisfiable else "All requires conditions are satisfiable.",
        ))

        overlap = [a for a in allows if any(_normalize_path_like(d) == _normalize_path_like(a) for d in denies)]
        total_overlap = len(overlap) > 0 and len(overlap) == len(allows) and len(allows) > 0
        properties.append(VerificationProperty(
            name="no_full_allow_deny_overlap",
            passed=not total_overlap,
            message="All allowed operations are also denied." if total_overlap else "Allows and denies are not fully contradictory.",
        ))

        passed = all(p.passed for p in properties)
        proof = VerificationProof(
            policy_id=contract_id,
            passed=passed,
            properties=properties,
        )

        if not passed:
            failed = [p for p in properties if not p.passed]
            proof.counterexample = CounterexampleTrace(
                contract_id=contract_id,
                invariant=", ".join(f.name for f in failed),
                input={
                    "contract": {
                        "id": contract_id,
                        "type": ctype,
                        "requires": requires,
                        "allows": allows,
                        "denies": denies,
                        "on_violation": on_violation,
                     }
                 },
                 trace=[f.message for f in failed],
             )

        return proof


class ZKPolicyProof:
    """V10.1.0: zero-knowledge proof that a policy held for an action.

    In production this would wrap a real ZK-SNARK/STARK circuit; here we
    provide a deterministic simulation so the SDK surface is available
    without external dependencies.
    """

    def __init__(self, policy_id: str, action: str, proof_data: Optional[Dict[str, Any]] = None, verified: bool = False):
        self.policy_id = policy_id
        self.action = action
        self.proof_data = proof_data or {}
        self.verified = verified
        self.verified_at: Optional[str] = None

    def generate(self, witness: Dict[str, Any]) -> Dict[str, Any]:
        witness_hash = _sha256(witness)
        proof_payload = {
            "policy_id": self.policy_id,
            "action": self.action,
            "witness_hash": witness_hash,
        }
        expected = _sha256(proof_payload)
        self.proof_data = {
            "policy_id": self.policy_id,
            "action": self.action,
            "witness_hash": witness_hash,
            "expected": expected,
            "generated_at": _now_iso(),
        }
        return self.proof_data

    def verify(self, trust_root: Optional[Dict[str, Any]] = None) -> bool:
        if not self.proof_data or "expected" not in self.proof_data:
            return False
        proof_payload = {
            "policy_id": self.proof_data["policy_id"],
            "action": self.proof_data["action"],
            "witness_hash": self.proof_data["witness_hash"],
        }
        expected = _sha256(proof_payload)
        ok = self.proof_data.get("expected") == expected
        if trust_root:
            ok = ok and trust_root.get("namespace") in (self.proof_data.get("policy_id", ""), "*")
        self.verified = ok
        self.verified_at = _now_iso()
        return ok

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "action": self.action,
            "proof_data": self.proof_data,
            "verified": self.verified,
            "verified_at": self.verified_at,
        }


def _sha256(obj: Any) -> str:
    import hashlib, json
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class ComplianceCertifier:
    """V10.2.0: produce a VC-signed attestation bundle for a run."""

    def __init__(self, trust_root=None):
        self.trust_root = trust_root

    def certify(self, run_id, profile, results):
        passed = all(r.get("passed", False) for r in results)
        bundle = {
            "run_id": run_id,
            "profile": profile,
            "passed": passed,
            "results": results,
            "issued_at": _now_iso(),
        }
        if self.trust_root:
            bundle["issuer"] = self.trust_root.get("namespace", "unknown")
            bundle["signature"] = _sha256(bundle)
        return bundle

    def verify_bundle(self, bundle):
        if "signature" not in bundle:
            return False
        payload = {k: v for k, v in bundle.items() if k != "signature"}
        return bundle.get("signature") == _sha256(payload)
