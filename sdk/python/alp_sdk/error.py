"""ALP parser errors (v5 — SDK hardening & parity).

Mirrors the TypeScript ``@alp/parser`` ``error.ts`` so the Python SDK raises
the same exception hierarchy as the TS parser for the same malformed input.
This lets cross-SDK conformance tests assert identical failure modes.
"""


class AlpError(Exception):
    """Base class for ALP parsing/validation errors, with optional source
    location (1-based ``line`` / ``column``)."""

    def __init__(self, message: str, line: int = None, column: int = None):
        loc = ""
        if line is not None:
            loc = f" at line {line}" + (f" column {column}" if column else "")
        super().__init__(f"{message}{loc}")
        self.line = line
        self.column = column


class SyntaxError(AlpError):  # noqa: A001 - mirrors the TS SyntaxError name
    """Raised for malformed ALP syntax (bad block markers, properties, lists)."""


class IndentationError(AlpError):  # noqa: A001 - mirrors the TS IndentationError name
    """Raised for invalid indentation (tabs, odd levels, unexpected depth)."""


class ValidationError(AlpError):
    """Raised when a parsed object fails schema validation."""

    def __init__(self, message: str, details=None, line: int = None, column: int = None):
        super().__init__(message, line, column)
        self.details = details
