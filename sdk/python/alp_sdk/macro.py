"""ALP MacroEngine — Dynamic @macro object generation (v37.0.0 — Python SDK parity).

Expands `@macro` blocks into concrete protocol objects by evaluating `iterate_over`
expressions and interpolating `${...}` template variables.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set

from .alpel import evaluate


class MacroDefinition:
    def __init__(self, id: str, iterate_over: str, template: Dict[str, Any], name: Optional[str] = None, as_: str = "item"):
        self.id = id
        self.iterate_over = iterate_over
        self.template = template
        self.name = name
        self.var_name = as_


def _interpolate_string(template: str, var_name: str, item: Any) -> str:
    def replacer(match: re.Match) -> str:
        expr = match.group(1).strip()
        if expr == var_name:
            return json.dumps(item) if isinstance(item, (dict, list)) else str(item)
        if expr.startswith(var_name + "."):
            prop = expr[len(var_name) + 1:]
            parts = prop.split(".")
            val = item
            for p in parts:
                if val is None or not isinstance(val, dict):
                    return ""
                val = val.get(p)
            return str(val) if val is not None else ""
        return match.group(0)

    return re.sub(r"\$\{([^}]+)\}", replacer, template)


def _interpolate_deep(obj: Any, var_name: str, item: Any) -> Any:
    if isinstance(obj, str):
        return _interpolate_string(obj, var_name, item)
    if isinstance(obj, list):
        return [_interpolate_deep(v, var_name, item) for v in obj]
    if isinstance(obj, dict):
        return {
            _interpolate_string(k, var_name, item): _interpolate_deep(v, var_name, item)
            for k, v in obj.items()
        }
    return obj


class MacroEngine:
    def expand(self, macro: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        macro_id = macro.get("id", "unnamed")
        iterate_over = macro.get("iterate_over")
        template = macro.get("template")
        var_name = macro.get("as", "item")

        if not iterate_over:
            raise ValueError(f"Macro '{macro_id}': missing iterate_over")
        if not template:
            raise ValueError(f"Macro '{macro_id}': missing template")

        raw = str(iterate_over).strip()
        if raw.startswith("["):
            # Try parsing JSON array directly
            try:
                items = json.loads(raw.replace("'", '"'))
            except Exception:
                items = evaluate(raw, context or {})
        else:
            items = evaluate(raw, context or {})

        if not isinstance(items, list):
            items = [items]

        expanded: List[Dict[str, Any]] = []
        seen_ids: Set[str] = set()

        for item in items:
            obj = _interpolate_deep(template, var_name, item)
            if isinstance(obj, dict):
                obj["_sourceMacro"] = macro_id
                obj_id = obj.get("id")
                if obj_id:
                    if obj_id in seen_ids:
                        raise ValueError(f"Macro '{macro_id}': duplicate generated id '{obj_id}'")
                    seen_ids.add(obj_id)
            expanded.append(obj)

        return expanded

    def expand_all(self, objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for obj in objects:
            if isinstance(obj, dict) and obj.get("_type") == "macro" and "iterate_over" in obj and "template" in obj:
                expanded = self.expand(obj)
                result.extend(expanded)
            else:
                result.append(obj)
        return result
