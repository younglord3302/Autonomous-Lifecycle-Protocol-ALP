"""ALP contract engine (v8.3.0 - Python SDK parity).

Mirrors the TypeScript ``ContractEngine``: validates whether a handoff
context satisfies a ``@contract`` object's ``requires``, ``allows``, and
``denies`` rules. Returns a ``ContractResult`` indicating pass/fail and an
optional ``ContractViolation``.
"""
from __future__ import annotations


from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from .models import AlpObject


@dataclass
class ContractViolation:
    contract_id: str
    rule: str
    reason: str
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ContractResult:
    ok: bool
    violation: Optional[ContractViolation] = None


@dataclass
class ContractObject:
    id: str
    name: Optional[str] = None
    from_: str = ''
    to: str = ''
    type: str = 'api'
    requires: List[str] = field(default_factory=list)
    allows: List[str] = field(default_factory=list)
    denies: List[str] = field(default_factory=list)
    on_violation: str = 'deny'


class ContractEngine:
    """Evaluate ``@contract`` objects against handoff contexts."""

    def __init__(self, objects: List[AlpObject]):
        self.contracts: Dict[str, ContractObject] = {}
        for obj in objects:
            if obj._type == 'contract':
                c = self._normalize(obj)
                self.contracts[c.id] = c

    @property
    def count(self) -> int:
        return len(self.contracts)

    def check(self, contract_id: str, context: Dict[str, Any]) -> ContractResult:
        contract = self.contracts.get(contract_id)
        if contract is None:
            return ContractResult(
                ok=False,
                violation=ContractViolation(
                    contract_id=contract_id,
                    rule='',
                    reason=f"contract '{contract_id}' not found",
                    context=context,
                ),
            )

        for req in contract.requires:
            if not _evaluate_require(req, context):
                return self._violation(contract, req, 'required condition not met', context)

        operation = str(context.get('operation', ''))

        if any(_matches_glob(operation, d) for d in contract.denies):
            return self._violation(contract, operation, 'denied', context)

        if contract.allows and operation not in contract.allows:
            return self._violation(contract, operation, 'not in allow-list', context)

        return ContractResult(ok=True)

    def list(self) -> List[ContractObject]:
        return list(self.contracts.values())

    def _violation(self, contract: ContractObject, rule: str, reason: str, context: Dict[str, Any]) -> ContractResult:
        violation = ContractViolation(contract_id=contract.id, rule=rule, reason=reason, context=context)
        if contract.on_violation == 'log':
            print(f"[contract] violation: {contract.id} — {rule}: {reason}")
        if contract.on_violation == 'warn':
            print(f"[contract] violation (warn): {contract.id} — {rule}: {reason}")
            return ContractResult(ok=True)
        return ContractResult(ok=False, violation=violation)

    @staticmethod
    def _normalize(obj: AlpObject) -> ContractObject:
        return ContractObject(
            id=obj.properties.get('id', ''),
            name=obj.properties.get('name'),
            from_=obj.properties.get('from', ''),
            to=obj.properties.get('to', ''),
            type=obj.properties.get('type', 'api'),
            requires=[str(r) for r in (obj.properties.get('requires') or [])],
            allows=[str(r) for r in (obj.properties.get('allows') or [])],
            denies=[str(r) for r in (obj.properties.get('denies') or [])],
            on_violation=obj.properties.get('on_violation', 'deny'),
        )


def _evaluate_require(expr: str, context: Dict[str, Any]) -> bool:
    expr = expr.strip()
    for op in ('<=', '>=', '!=', '==', '<', '>'):
        if op in expr:
            parts = expr.split(op, 1)
            if len(parts) == 2:
                key = parts[0].strip()
                raw_value = parts[1].strip()
                actual = _get_nested(context, key)
                expected = _parse_value(raw_value)
                if actual is None:
                    return False
                try:
                    if op == '<':  return float(actual) < float(expected)
                    if op == '>':  return float(actual) > float(expected)
                    if op == '<=': return float(actual) <= float(expected)
                    if op == '>=': return float(actual) >= float(expected)
                    if op == '==': return actual == expected
                    if op == '!=': return actual != expected
                except (TypeError, ValueError):
                    return False
            return True
    # No comparison operator — try "key value" as implicit equality.
    parts = expr.split()
    if len(parts) == 2:
        key, raw_value = parts
        actual = _get_nested(context, key)
        expected = _parse_value(raw_value)
        return actual == expected
    val = _get_nested(context, expr)
    return val is not None and val is not False


def _get_nested(context: Dict[str, Any], key: str) -> Any:
    parts = key.split('.')
    cur: Any = context
    for part in parts:
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _parse_value(raw: str) -> Any:
    if raw == 'true':
        return True
    if raw == 'false':
        return False
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def _matches_glob(value: str, pattern: str) -> bool:
    if pattern.endswith('.*'):
        prefix = pattern[:-2]
        return value.startswith(prefix)
    return value == pattern
