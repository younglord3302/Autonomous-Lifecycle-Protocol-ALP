"""ALP Expression Language (ALPEL, spec/12) — v10.3.0 Python SDK parity.

Mirrors the TypeScript ``@alp/parser`` ``alpel.ts``. ALPEL is a secure,
sandboxed, read-only expression language for conditional logic (``!if``,
``!assert``, engine conditions) and string interpolation (``${ }``). No
mutation, no I/O, deterministic (spec/12 §6).

Supported:
  - Primitives: strings, numbers, true/false, null
  - Property access: ``task.feature.name``, ``feature.metadata['k']``
  - Comparison: == != < > <= >=
  - Logical: && || !
  - Math: + - * /
  - Collection: in, contains
  - Built-ins: length, toUpper, toLower, startsWith, size, isEmpty, hasStatus
  - Namespace built-ins (v10.3.0): date.*, math.*, crypto.*, string.*
  - Interpolation: ``${ expr }`` within string values
"""

import hashlib
import base64 as _base64
import datetime
from typing import Any, Dict, List, Optional, Union

AlpelValue = Union[str, int, float, bool, None, List[Any], Dict[str, Any]]

EvalContext = Dict[str, Any]

CONTEXT_KEYS = ["project", "task", "feature", "agent", "env", "state"]
NS_PREFIX = "__ALPEL_NS__:"
NAMESPACE_NAMES = ["date", "math", "crypto", "string"]


class AlpelError(Exception):
    """Raised for any ALPEL parse/evaluation error."""


# ── Tokenizer ──

_Token = Dict[str, Any]


def _tokenize(expr: str) -> List[_Token]:
    tokens: List[_Token] = []
    i = 0
    n = len(expr)
    while i < n:
        ch = expr[i]
        if ch in " \t\n\r":
            i += 1
            continue
        if ch == "(":
            tokens.append({"t": "lp", "v": "("}); i += 1; continue
        if ch == ")":
            tokens.append({"t": "rp", "v": ")"}); i += 1; continue
        if ch == ",":
            tokens.append({"t": "comma", "v": ","}); i += 1; continue
        if ch == ":":
            tokens.append({"t": "colon", "v": ":"}); i += 1; continue
        if ch == "[":
            tokens.append({"t": "lb", "v": "["}); i += 1; continue
        if ch == "]":
            tokens.append({"t": "rb", "v": "]"}); i += 1; continue
        if ch == ".":
            tokens.append({"t": "dot", "v": "."}); i += 1; continue
        if ch == "{":
            tokens.append({"t": "lbrace", "v": "{"}); i += 1; continue
        if ch == "}":
            tokens.append({"t": "rbrace", "v": "}"}); i += 1; continue
        if ch == "&" and i + 1 < n and expr[i + 1] == "&":
            tokens.append({"t": "op", "v": "&&"}); i += 2; continue
        if ch == "|" and i + 1 < n and expr[i + 1] == "|":
            tokens.append({"t": "op", "v": "||"}); i += 2; continue
        if ch == "=" and i + 1 < n and expr[i + 1] == "=":
            tokens.append({"t": "op", "v": "=="}); i += 2; continue
        if ch == "!" and i + 1 < n and expr[i + 1] == "=":
            tokens.append({"t": "op", "v": "!="}); i += 2; continue
        if ch == "<" and i + 1 < n and expr[i + 1] == "=":
            tokens.append({"t": "op", "v": "<="}); i += 2; continue
        if ch == ">" and i + 1 < n and expr[i + 1] == "=":
            tokens.append({"t": "op", "v": ">="}); i += 2; continue
        if ch in "=<>" and not (i + 1 < n and expr[i + 1] == "="):
            # single-char comparison only when not part of a double char above
            tokens.append({"t": "op", "v": ch}); i += 1; continue
        if ch == "!":
            tokens.append({"t": "op", "v": "!"}); i += 1; continue
        if ch in "+-*/":
            tokens.append({"t": "op", "v": ch}); i += 1; continue
        if ch == '"' or ch == "'":
            start = i
            i += 1
            while i < n and expr[i] != ch:
                i += 1
            i += 1
            tokens.append({"t": "str", "v": expr[start + 1: i - 1]})
            continue
        if ch.isdigit() or (ch == "-" and i + 1 < n and expr[i + 1].isdigit()):
            start = i
            i += 1
            while i < n and expr[i] in "0123456789.":
                i += 1
            tokens.append({"t": "num", "v": float(expr[start:i]) if "." in expr[start:i] else int(expr[start:i])})
            continue
        if ch.isalpha() or ch == "_":
            start = i
            i += 1
            while i < n and (expr[i].isalnum() or expr[i] == "_"):
                i += 1
            word = expr[start:i]
            if word == "true":
                tokens.append({"t": "bool", "v": True})
            elif word == "false":
                tokens.append({"t": "bool", "v": False})
            elif word == "null":
                tokens.append({"t": "null", "v": None})
            elif word == "in":
                tokens.append({"t": "op", "v": word})
            else:
                tokens.append({"t": "id", "v": word})
            continue
        raise AlpelError(f"ALPEL: unexpected character '{ch}'")
    return tokens


# ── Parser (precedence: || < && < comparison < +/- < *// < unary ! < postfix) ──

ExprFn = Any  # callable(EvalContext) -> AlpelValue


def _parse_expr(tokens: List[_Token]) -> ExprFn:
    pos = 0

    def peek() -> Optional[_Token]:
        return tokens[pos] if pos < len(tokens) else None

    def nxt() -> _Token:
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        return tok

    def parse_or() -> ExprFn:
        left = parse_and()
        while peek() and peek()["t"] == "op" and peek()["v"] == "||":
            nxt()
            right = parse_and()
            l = left
            left = lambda c, l=l, r=right: bool(l(c) or r(c))
        return left

    def parse_and() -> ExprFn:
        left = parse_comparison()
        while peek() and peek()["t"] == "op" and peek()["v"] == "&&":
            nxt()
            right = parse_comparison()
            l = left
            left = lambda c, l=l, r=right: bool(l(c) and r(c))
        return left

    def parse_comparison() -> ExprFn:
        left = parse_add()
        op = peek()
        if op and op["t"] == "op" and op["v"] in ("==", "!=", "<", ">", "<=", ">="):
            nxt()
            right = parse_add()
            l = left
            ov = op["v"]
            return lambda c, l=l, r=right, ov=ov: _compare(l(c), ov, r(c))
        if op and op["t"] == "op" and op["v"] == "in":
            nxt()
            right = parse_add()
            l = left
            return lambda c, l=l, r=right: _in_op(l(c), r(c))
        return left

    def parse_add() -> ExprFn:
        left = parse_mul()
        while peek() and peek()["t"] == "op" and peek()["v"] in ("+", "-"):
            v = nxt()["v"]
            right = parse_mul()
            l = left
            return lambda c, l=l, r=right, v=v: _add(l(c), r(c), v)
        return left

    def parse_mul() -> ExprFn:
        left = parse_unary()
        while peek() and peek()["t"] == "op" and peek()["v"] in ("*", "/"):
            v = nxt()["v"]
            right = parse_unary()
            l = left
            return lambda c, l=l, r=right, v=v: _mul(l(c), r(c), v)
        return left

    def parse_unary() -> ExprFn:
        if peek() and peek()["t"] == "op" and peek()["v"] == "!":
            nxt()
            inner = parse_unary()
            return lambda c, inner=inner: not _truthy(inner(c))
        if peek() and peek()["t"] == "op" and peek()["v"] == "-":
            nxt()
            inner = parse_unary()
            return lambda c, inner=inner: _neg(inner(c))
        if peek() and peek()["t"] == "op" and peek()["v"] == "+":
            nxt()
            return parse_unary()
        return parse_postfix()

    def parse_postfix() -> ExprFn:
        node = parse_primary()
        is_name = getattr(node, "__id", None) is not None
        while True:
            t = peek()
            if not t:
                break
            if t["t"] == "dot":
                nxt()
                ident = nxt()
                if not ident or ident["t"] != "id":
                    raise AlpelError("ALPEL: expected property after .")
                base = node
                name = ident["v"]
                node = lambda c, base=base, name=name: _get_prop(base(c), name)
                node.__id = name  # type: ignore[attr-defined]
                node.__base = base  # type: ignore[attr-defined]
                is_name = True
            elif t["t"] == "lb":
                nxt()
                key_tok = peek()
                if key_tok and key_tok["t"] in ("str", "id", "num"):
                    key = nxt()["v"]
                else:
                    key = parse_or()
                if not peek() or peek()["t"] != "rb":
                    raise AlpelError("ALPEL: expected ]")
                nxt()
                base = node
                node = lambda c, base=base, key=key: _get_prop(base(c), key)
                is_name = False
            elif t["t"] == "lp":
                if not is_name:
                    nxt()
                    e = parse_or()
                    if not peek() or peek()["t"] != "rp":
                        raise AlpelError("ALPEL: expected )")
                    nxt()
                    node = e
                else:
                    nxt()
                    fn_name = node.__id
                    base = getattr(node, "__base", None)
                    args: List[ExprFn] = []
                    if not peek() or peek()["t"] != "rp":
                        args.append(parse_or())
                        while peek() and peek()["t"] == "comma":
                            nxt()
                            args.append(parse_or())
                    if not peek() or peek()["t"] != "rp":
                        raise AlpelError("ALPEL: expected )")
                    nxt()
                    fargs = args
                    if base is not None:
                        node = lambda c, fn_name=fn_name, fargs=fargs, base=base: _call_fn(fn_name, [base(c)] + [a(c) for a in fargs])
                    else:
                        node = lambda c, fn_name=fn_name, fargs=fargs: _call_fn(fn_name, [a(c) for a in fargs])
                is_name = False
            else:
                break
        return node

    def parse_primary() -> ExprFn:
        tok = peek()
        if not tok:
            raise AlpelError("ALPEL: unexpected end of expression")
        if tok["t"] == "lp":
            nxt()
            e = parse_or()
            if not peek() or peek()["t"] != "rp":
                raise AlpelError("ALPEL: expected )")
            nxt()
            return e
        if tok["t"] == "lb":
            nxt()
            items: List[ExprFn] = []
            if not peek() or peek()["t"] != "rb":
                items.append(parse_or())
                while peek() and peek()["t"] == "comma":
                    nxt()
                    items.append(parse_or())
            if not peek() or peek()["t"] != "rb":
                raise AlpelError("ALPEL: expected ]")
            nxt()
            return lambda c, items=items: [a(c) for a in items]
        if tok["t"] == "lbrace":
            nxt()
            obj: Dict[str, ExprFn] = {}
            if not peek() or peek()["t"] != "rbrace":
                while True:
                    key_tok = nxt()
                    key = key_tok["v"] if key_tok["t"] in ("str", "id") else None
                    if key is None:
                        raise AlpelError("ALPEL: expected object key")
                    if not peek() or peek()["t"] != "colon":
                        raise AlpelError("ALPEL: expected :")
                    nxt()
                    val = parse_or()
                    obj[key] = val
                    if peek() and peek()["t"] == "comma":
                        nxt()
                        continue
                    break
            if not peek() or peek()["t"] != "rbrace":
                raise AlpelError("ALPEL: expected }")
            nxt()
            return lambda c, obj=obj: {k: v(c) for k, v in obj.items()}
        if tok["t"] == "num":
            nxt()
            v = tok["v"]
            return lambda c, v=v: v
        if tok["t"] == "str":
            nxt()
            v = tok["v"]
            return lambda c, v=v: v
        if tok["t"] == "bool":
            nxt()
            v = tok["v"]
            return lambda c, v=v: v
        if tok["t"] == "null":
            nxt()
            return lambda c: None
        if tok["t"] == "id":
            nxt()
            v = tok["v"]
            node = lambda c, v=v: _resolve_id(c, v)
            node.__id = v  # type: ignore[attr-defined]
            return node
        raise AlpelError(f"ALPEL: unexpected token '{tok}'")

    return parse_or()


# ── Evaluation helpers ──

def _truthy(v: AlpelValue) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return len(v) > 0
    if isinstance(v, list):
        return len(v) > 0
    return v is not None


def _alp_equals(a: AlpelValue, b: AlpelValue) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, bool) and isinstance(b, bool):
        return a == b
    if a is None and b is None:
        return True
    return False


def _compare(a: AlpelValue, op: str, b: AlpelValue) -> bool:
    if op == "==":
        return _alp_equals(a, b)
    if op == "!=":
        return not _alp_equals(a, b)
    if op in ("<", ">", "<=", ">="):
        av = a if isinstance(a, (int, float, str)) else None
        bv = b if isinstance(b, (int, float, str)) else None
        if av is None or bv is None:
            raise AlpelError("ALPEL: < > <= >= need comparable values")
        if av < bv:
            return op in ("<", "<=")
        if av > bv:
            return op in (">", ">=")
        return op in ("<=", ">=")
    raise AlpelError(f"ALPEL: unknown comparison '{op}'")


def _in_op(a: AlpelValue, b: AlpelValue) -> bool:
    if isinstance(b, list):
        return any(_alp_equals(x, a) for x in b)
    if isinstance(b, str) and isinstance(a, str):
        return a in b
    return False


def _neg(v: AlpelValue) -> AlpelValue:
    if isinstance(v, (int, float)):
        return -v
    raise AlpelError("ALPEL: unary - requires a number")


def _get_prop(base: AlpelValue, key: Any) -> AlpelValue:
    if base is None:
        return None
    if isinstance(base, list):
        if key == "size":
            return len(base)
        if key == "isEmpty":
            return len(base) == 0
        if isinstance(key, int):
            return base[key] if 0 <= key < len(base) else None
        return None
    if isinstance(base, dict):
        if key == "size":
            return len(base)
        if key == "isEmpty":
            return len(base) == 0
        k = str(key)
        return base.get(k, None)
    return None


def _resolve_id(ctx: EvalContext, name: str) -> AlpelValue:
    if name in ctx:
        return ctx[name]
    if name in NAMESPACE_NAMES:
        return NS_PREFIX + name
    for k in CONTEXT_KEYS:
        c = ctx.get(k)
        if isinstance(c, dict) and name in c:
            return c[name]
    raise AlpelError(f"ALPEL: unknown identifier '{name}'")


def _add(a: AlpelValue, b: AlpelValue, op: str) -> AlpelValue:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a + b if op == "+" else a - b
    if isinstance(a, str):
        return a + ("" if b is None else str(b))
    raise AlpelError("ALPEL: + / - require numbers or a string")


def _mul(a: AlpelValue, b: AlpelValue, op: str) -> AlpelValue:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a * b if op == "*" else (a / b if b != 0 else (_raise_zero_div()))
    raise AlpelError("ALPEL: * / require numbers")


def _raise_zero_div():
    raise AlpelError("ALPEL: division by zero")


def _call_ns_fn(ns: str, name: str, args: List[AlpelValue]) -> AlpelValue:
    if ns == "date":
        return _call_date_fn(name, args)
    if ns == "math":
        return _call_math_fn(name, args)
    if ns == "crypto":
        return _call_crypto_fn(name, args)
    if ns == "string":
        return _call_string_fn(name, args)
    raise AlpelError(f"ALPEL: unknown namespace '{ns}'")


def _call_date_fn(name: str, args: List[AlpelValue]) -> AlpelValue:
    if name == "now":
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    if name == "formatDate":
        d = args[0] if args else None
        fmt = args[1] if len(args) > 1 else None
        if not isinstance(d, str) or not isinstance(fmt, str):
            return ""
        if fmt == "iso":
            return d
        try:
            dt = datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
        except Exception:
            return d
        pad = lambda n: str(n).zfill(2)
        if fmt == "date":
            return f"{dt.year}-{pad(dt.month)}-{pad(dt.day)}"
        if fmt == "time":
            return f"{pad(dt.hour)}:{pad(dt.minute)}:{pad(dt.second)}"
        return d
    if name == "parseDate":
        s = args[0] if args else None
        if not isinstance(s, str):
            return ""
        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.isoformat()
        except Exception:
            return s
    if name == "addDays":
        d = args[0] if args else None
        n = args[1] if len(args) > 1 else 0
        if not isinstance(d, str) or not isinstance(n, (int, float)):
            return ""
        try:
            dt = datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
            dt = dt + datetime.timedelta(days=int(n))
            return dt.isoformat()
        except Exception:
            return d
    raise AlpelError(f"ALPEL: date.{name} is undefined")


def _call_math_fn(name: str, args: List[AlpelValue]) -> AlpelValue:
    a = args[0] if args else 0
    b = args[1] if len(args) > 1 else 0
    if name == "round":
        return round(a)
    if name == "floor":
        return __import__("math").floor(a)
    if name == "ceil":
        return __import__("math").ceil(a)
    if name == "min":
        return min(a, b)
    if name == "max":
        return max(a, b)
    if name == "abs":
        return abs(a)
    raise AlpelError(f"ALPEL: math.{name} is undefined")


def _call_crypto_fn(name: str, args: List[AlpelValue]) -> AlpelValue:
    s = str(args[0] if args else "")
    if name == "sha256":
        return hashlib.sha256(s.encode("utf-8")).hexdigest()
    if name == "base64":
        return _base64.b64encode(s.encode("utf-8")).decode("utf-8")
    if name == "base64Decode":
        return _base64.b64decode(s.encode("utf-8")).decode("utf-8")
    raise AlpelError(f"ALPEL: crypto.{name} is undefined")


def _call_string_fn(name: str, args: List[AlpelValue]) -> AlpelValue:
    a = args[0] if args else None
    if name == "trim":
        return a.strip() if isinstance(a, str) else str(a)
    if name == "replace":
        s = a if isinstance(a, str) else str(a)
        old = args[1] if len(args) > 1 else ""
        new = args[2] if len(args) > 2 else ""
        return s.replace(str(old), str(new))
    if name == "split":
        s = a if isinstance(a, str) else str(a)
        delim = args[1] if len(args) > 1 else ""
        return s.split(str(delim))
    if name == "join":
        arr = a if isinstance(a, list) else []
        delim = args[1] if len(args) > 1 else ""
        return str(delim).join(str(x) for x in arr)
    if name == "endsWith":
        s = a if isinstance(a, str) else str(a)
        suf = args[1] if len(args) > 1 else ""
        return s.endswith(str(suf))
    raise AlpelError(f"ALPEL: string.{name} is undefined")


# ── Module imports (v10.3.0): shared ALPEL snippets ──

_MODULES: Dict[str, Dict[str, Any]] = {}


def register_module(name: str, defs: Dict[str, Any]) -> None:
    """Register a named module of reusable constants/snippets for ALPEL ``import()``."""
    _MODULES[name] = defs


def import_module(name: str) -> Dict[str, Any]:
    """Retrieve a registered module object (property-accessible in ALPEL)."""
    if name not in _MODULES:
        raise AlpelError(f"ALPEL: module '{name}' is not registered")
    return _MODULES[name]


def _call_fn(name: str, args: List[AlpelValue]) -> AlpelValue:
    a = args[0] if args else None
    if name == "import":
        mod_name = a if isinstance(a, str) else ""
        return import_module(mod_name)
    if isinstance(a, str) and a.startswith(NS_PREFIX):
        ns = a[len(NS_PREFIX):]
        return _call_ns_fn(ns, name, args[1:])
    if name == "length":
        if isinstance(a, str):
            return len(a)
        if isinstance(a, list):
            return len(a)
        return 0
    if name == "toUpper":
        return (a if isinstance(a, str) else str(a)).upper()
    if name == "toLower":
        return (a if isinstance(a, str) else str(a)).lower()
    if name == "startsWith":
        return isinstance(a, str) and len(args) > 1 and isinstance(args[1], str) and a.startswith(args[1])
    if name == "size":
        if isinstance(a, list):
            return len(a)
        if isinstance(a, dict):
            return len(a)
        return 0
    if name == "isEmpty":
        if isinstance(a, list):
            return len(a) == 0
        if isinstance(a, dict):
            return len(a) == 0
        return True
    if name == "contains":
        if isinstance(a, list):
            return any(_alp_equals(x, args[1]) for x in a)
        if isinstance(a, str) and len(args) > 1 and isinstance(args[1], str):
            return args[1] in a
        return False
    if name == "hasStatus":
        if isinstance(a, list):
            return any(isinstance(t, dict) and t.get("status") == args[1] for t in a)
        return False
    raise AlpelError(f"ALPEL: unknown function '{name}'")


# ── Public API ──

def build_context(obj: Optional[Dict[str, Any]], extra: EvalContext = None) -> EvalContext:
    """Build an evaluation context from the surrounding ALP object."""
    ctx: EvalContext = {}
    extra = extra or {}
    if obj:
        otype = obj.get("_type")
        if otype:
            ctx[otype] = obj
        for k in CONTEXT_KEYS:
            v = obj.get(k)
            if v is not None:
                ctx[k] = v
    merged = dict(ctx)
    merged.update(extra)
    return merged


def evaluate(expr: str, ctx: EvalContext) -> AlpelValue:
    """Evaluate an ALPEL boolean/value expression against a context."""
    tokens = _tokenize(expr)
    fn = _parse_expr(tokens)
    return fn(ctx)


def evaluate_bool(expr: str, ctx: EvalContext) -> bool:
    """Evaluate as a boolean (for ``!if`` / ``!assert``)."""
    return _truthy(evaluate(expr, ctx))


import re as _re

_INTERP_RE = _re.compile(r"\$\{\s*([^}]+?)\s*\}")


def interpolate(value: str, ctx: EvalContext) -> str:
    """Expand ``${ expr }`` interpolations using an ALPEL context.

    Unknown identifiers resolve to empty strings (deterministic, no throw).
    """
    def repl(m):
        try:
            v = evaluate(m.group(1).strip(), ctx)
            if v is None:
                return ""
            if isinstance(v, (str, int, float, bool)):
                return str(v)
            return _json_dumps(v)
        except Exception:
            return ""
    return _INTERP_RE.sub(repl, value)


def _json_dumps(v: AlpelValue) -> str:
    try:
        import json
        return json.dumps(v)
    except Exception:
        return str(v)
