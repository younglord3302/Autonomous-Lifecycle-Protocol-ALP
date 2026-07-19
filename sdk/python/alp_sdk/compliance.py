"""ALP Compliance Test Suite harness (v6.9.0 - Python SDK parity, spec/16).

Mirrors the TypeScript ``@alp/cli`` ``alp test-harness`` (v6.2.0): runs the
bundled ``tests/compliance/{valid,invalid}`` fixtures through the Python SDK
reader+validator and asserts correct categorization. ``valid`` fixtures MUST
parse without error; ``invalid`` fixtures MUST raise. Supports an optional
external parser executable and a custom ``--suite`` directory (spec/16 §5).
"""

import os
import subprocess
import sys
from dataclasses import dataclass
from typing import List, Optional

from .reader import AlpParser
from .error import AlpError


@dataclass
class HarnessResult:
    file: str
    kind: str  # 'valid' | 'invalid'
    passed: bool
    detail: Optional[str] = None


def _list_fixtures(directory: str) -> List[str]:
    if not os.path.isdir(directory):
        return []
    return sorted(f for f in os.listdir(directory) if f.endswith(".alp"))


def _run_bundled(fixture_path: str) -> bool:
    """Run a fixture through the bundled Python SDK. Returns True if it parses."""
    from .reader import AlpParser

    parser = AlpParser()
    try:
        parser.parse_and_validate(open(fixture_path, "r", encoding="utf-8").read())
        return True
    except AlpError:
        return False
    except Exception:
        # Non-ALP errors still mean the fixture was not accepted.
        return False


def _run_external(executable: str, fixture_path: str) -> bool:
    """Run a fixture through an external parser executable (spec/16 §5).

    Contract: the executable receives the fixture path as its sole argument,
    prints the AST as JSON to stdout on success, and exits non-zero on failure.
    """
    try:
        subprocess.run(
            [executable, fixture_path],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


def run_suite(suite_dir: Optional[str] = None, executable: Optional[str] = None) -> List[HarnessResult]:
    """Run the compliance suite and return per-fixture results (spec/16 §5)."""
    if suite_dir is None:
        # Default: <repo>/tests/compliance, resolved from this file
        # (sdk/python/alp_sdk/compliance.py -> sdk/python/alp_sdk -> sdk/python -> sdk -> repo).
        here = os.path.dirname(os.path.abspath(__file__))
        repo = os.path.dirname(os.path.dirname(os.path.dirname(here)))
        suite_dir = os.path.join(repo, "tests", "compliance")

    valid_dir = os.path.join(suite_dir, "valid")
    invalid_dir = os.path.join(suite_dir, "invalid")

    if not os.path.isdir(valid_dir) and not os.path.isdir(invalid_dir):
        raise FileNotFoundError(
            f"Compliance suite not found at '{suite_dir}'. "
            f"Provide one with suite_dir= or run from a repo that ships tests/compliance."
        )

    runner = _run_external if executable else _run_bundled
    results: List[HarnessResult] = []

    for f in _list_fixtures(valid_dir):
        p = os.path.join(valid_dir, f)
        ok = runner(p)
        results.append(HarnessResult(f, "valid", ok, None if ok else "parser rejected a valid fixture"))

    for f in _list_fixtures(invalid_dir):
        p = os.path.join(invalid_dir, f)
        ok = runner(p)
        # invalid fixtures MUST fail to parse.
        passed = not ok
        detail = None if passed else "parser accepted an invalid fixture"
        if ok:
            detail = "parser accepted an invalid fixture"
        results.append(HarnessResult(f, "invalid", passed, detail))

    return results


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point mirroring ``alp test-harness`` (spec/16 §5)."""
    argv = argv if argv is not None else sys.argv[1:]
    suite_dir = None
    executable = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--suite":
            i += 1
            suite_dir = argv[i]
        elif a == "--executable":
            i += 1
            executable = argv[i]
        elif a.startswith("--suite="):
            suite_dir = a.split("=", 1)[1]
        elif a.startswith("--executable="):
            executable = a.split("=", 1)[1]
        i += 1

    try:
        results = run_suite(suite_dir, executable)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 1

    passed = failed = 0
    for r in results:
        icon = "PASS" if r.passed else "FAIL"
        if r.passed:
            passed += 1
        else:
            failed += 1
        line = f"{icon} [{r.kind}] {r.file}"
        if not r.passed and r.detail:
            line += f" — {r.detail}"
        print(line)

    print("")
    print(f"Compliance suite: {passed} passed, {failed} failed ({len(results)} fixtures)")
    if executable:
        print(f"Parser under test: {executable}")
    return 1 if failed > 0 else 0
