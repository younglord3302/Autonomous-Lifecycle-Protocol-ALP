"""ALP workspace reader (v5 — SDK hardening & parity).

Mirrors the TypeScript ``@alp/parser`` ``reader.ts`` exactly: the same
indentation rules, the same block-marker grammar, and the same error cases.
A line-by-line parser for ``.alp`` files producing a list of ``AlpObject``.

Indentation contract (spec/16.4):
  * Tab characters are rejected (use spaces).
  * Properties are indented by exactly 2 spaces; list items / nested
    properties by exactly 4.
  * Odd levels (1, 3) and even levels beyond 4 are rejected.
"""

import os
import re
from typing import Any, Dict, List

from .models import AlpObject
from .error import SyntaxError, IndentationError


class AlpReader:
    def parse(self, content: str) -> List[AlpObject]:
        lines = content.split("\n")
        objects: List[AlpObject] = []

        current_obj: Dict[str, Any] = None
        current_nested: str = None
        current_list: str = None

        for line_num, line in enumerate(lines, start=1):
            # Tab characters are not allowed (spec 16.4).
            tab_idx = line.find("\t")
            if tab_idx != -1:
                raise IndentationError(
                    "Tab characters are not allowed. Use spaces for indentation.",
                    line_num,
                    tab_idx + 1,
                )

            trimmed = line.strip()

            # Skip empty lines, comments, and markdown separators.
            if not trimmed or trimmed.startswith("//") or trimmed == "---":
                continue

            indent = len(line) - len(line.lstrip())

            # ── Level 0: directives and top-level block markers ──
            if indent == 0:
                if trimmed.startswith("!"):
                    continue
                type_match = re.match(r"^@([a-z_]+)$", trimmed)
                if type_match:
                    if current_obj:
                        objects.append(AlpObject.from_dict(current_obj))
                    current_obj = {"_type": type_match.group(1)}
                    current_nested = None
                    current_list = None
                    continue
                raise SyntaxError(f"Invalid block marker: '{trimmed}'", line_num)

            # ── Level 1 (indent=2): properties and nested block markers ──
            if indent == 2 and current_obj is not None:
                nested_match = re.match(r"^@([a-z_]+)$", trimmed)
                if nested_match:
                    current_nested = nested_match.group(1)
                    current_obj[current_nested] = []
                    current_list = None
                    continue

                list_match = re.match(r"^([a-z_]+):$", trimmed)
                if list_match:
                    current_list = list_match.group(1)
                    current_obj[current_list] = []
                    current_nested = None
                    continue

                prop_match = re.match(r"^([a-z_!][a-z0-9_-]*):\s*(.*)$", trimmed)
                if prop_match:
                    key = prop_match.group(1)
                    value = prop_match.group(2)
                    # Normalize directive properties by stripping the ! so they
                    # map to JSON Schema correctly (mirrors TS reader).
                    if key.startswith("!"):
                        key = key[1:].replace("-", "_")
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    elif value.startswith('"') and not value.endswith('"'):
                        raise SyntaxError("Unclosed string literal", line_num)
                    current_obj[key] = value
                    current_nested = None
                    current_list = None
                    continue

                raise SyntaxError(f"Invalid property format: '{trimmed}'", line_num)

            # ── Level 2 (indent=4): list items and nested properties ──
            if indent == 4 and current_obj is not None and (current_nested or current_list):
                if trimmed.startswith("- "):
                    val = trimmed[2:].strip()
                    # Strip surrounding quotes so list values (e.g. `verify`
                    # shell commands) match the unquoting applied to scalars.
                    if len(val) >= 2 and (
                        (val.startswith('"') and val.endswith('"'))
                        or (val.startswith("'") and val.endswith("'"))
                    ):
                        val = val[1:-1]
                    if current_nested and isinstance(current_obj[current_nested], list):
                        current_obj[current_nested].append(val)
                    elif current_list and isinstance(current_obj[current_list], list):
                        current_obj[current_list].append(val)
                    continue

                nested_prop_match = re.match(r"^([a-z_][a-z0-9_-]*):\s*(.*)$", trimmed)
                if nested_prop_match and current_list:
                    if isinstance(current_obj[current_list], list):
                        current_obj[current_list] = {}
                    key = nested_prop_match.group(1)
                    value = nested_prop_match.group(2)
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    # Numeric conversion for limits/thresholds (mirrors TS).
                    try:
                        current_obj[current_list][key] = int(value)
                    except ValueError:
                        current_obj[current_list][key] = value
                    continue

                raise SyntaxError(f"Invalid list item or nested property format: '{trimmed}'", line_num)

            # ── Invalid indentation ──
            if current_obj is not None and indent > 0:
                if indent in (1, 3) or (indent > 4 and indent % 2 != 0):
                    raise IndentationError(
                        f"Invalid indentation: {indent} spaces. Properties must be indented by exactly 2 spaces.",
                        line_num,
                    )
                raise IndentationError(f"Unexpected indentation level: {indent} spaces", line_num)

            if current_obj is None and indent > 0:
                raise IndentationError("Unexpected indentation outside of a block", line_num)

            raise SyntaxError(f"Unrecognized syntax: '{trimmed}'", line_num)

        if current_obj:
            objects.append(AlpObject.from_dict(current_obj))

        return objects


class AlpParser:
    """High-level entry point mirroring the TypeScript ``@alp/parser``
    ``AlpParser``. Wraps ``AlpReader`` and optionally schema-validates the
    parsed objects in one call."""

    def __init__(self):
        self._reader = AlpReader()

    def parse(self, content: str) -> List[AlpObject]:
        return self._reader.parse(content)

    def parse_and_validate(self, content: str) -> List[AlpObject]:
        from .validator import validate_object

        objects = self._reader.parse(content)
        for obj in objects:
            validate_object(obj._type, obj.properties)
        return objects


def load_workspace(dir_path: str) -> List[AlpObject]:
    alp_dir = os.path.join(dir_path, ".alp")
    if not os.path.exists(alp_dir):
        return []

    reader = AlpReader()
    all_objects: List[AlpObject] = []

    for root, _dirs, files in os.walk(alp_dir):
        for filename in files:
            if filename.endswith(".alp"):
                filepath = os.path.join(root, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        content = f.read()
                except (IsADirectoryError, PermissionError):
                    # Skip entries that look like files but resolve to dirs
                    # (e.g. a `.alp` symlink to a directory).
                    continue
                all_objects.extend(reader.parse(content))

    return all_objects
