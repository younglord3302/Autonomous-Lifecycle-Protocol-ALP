# ALP Specification — Compliance Test Suite

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

The **ALP Compliance Test Suite** provides a standardized set of test fixtures to ensure that custom parser implementations conform to the ALP v1.0.0 specification.

Because ALP uses strict indentation, typed object validation, and complex dependency graph resolution, subtle parsing errors can lead to corrupt agent contexts. Passing the compliance suite guarantees interoperability across the ecosystem.

---

## 2. Test Suite Structure

The compliance suite is organized into two primary categories: `valid` and `invalid`.

```
tests/compliance/
├── valid/
│   ├── 01-minimal.alp
│   ├── 02-all-types.alp
│   ├── 03-multiline-strings.alp
│   └── ... (and their expected output ASTs in JSON)
└── invalid/
    ├── 01-bad-indent.alp
    ├── 02-missing-id.alp
    ├── 03-tab-characters.alp
    └── ... (and their expected error codes)
```

---

## 3. Valid Test Cases

Files in the `valid/` directory MUST be parsed without errors. 

For strict compliance, parser developers SHOULD compare their parser's internal Abstract Syntax Tree (AST) output against the provided `.json` baseline files in the directory to ensure properties, lists, and multi-line strings were extracted correctly.

### Key Validation Areas:
- Preservation of leading whitespace in multi-line strings.
- Correct merging of block properties and nested blocks.
- Accurate identification of `inline_id` vs `id` property.
- Successful resolution of ALPEL interpolation nodes `${ }`.

---

## 4. Invalid Test Cases

Files in the `invalid/` directory MUST trigger a parser error. The parser MUST halt and reject the file.

### Error Reporting Requirements
To pass the compliance suite, a parser MUST report errors that include:
1. **Line number** of the violation.
2. **Column number** (if applicable).
3. **Error Category** (e.g., `SyntaxError`, `IndentationError`, `ValidationError`).

### Key Violation Areas:
- **Tabs:** Any `\t` character used for indentation MUST throw an `IndentationError`.
- **Indentation Levels:** A property indented by 3 spaces (instead of 2) MUST throw an `IndentationError`.
- **Missing Required Fields:** A `@task` without an `id` MUST throw a `ValidationError`.
- **Unclosed Strings:** A missing closing quote MUST throw a `SyntaxError`.
- **Invalid Enums:** Passing `priority: extreme` MUST throw a `ValidationError`.

---

## 5. Running the Suite

The compliance harness is provided as a CLI tool: `alp test-harness` (v6.2.0).

- With no arguments it runs the bundled `@alp/parser` against `tests/compliance` and exits non-zero on any miscategorized fixture.
- Use `--executable <cmd>` to certify an external parser: the executable receives the fixture path as its sole argument, prints the AST as JSON to `stdout` on success, and exits non-zero (error to `stderr`) on failure.
- Use `--suite <dir>` to point at a different fixture directory.

```bash
alp test-harness
alp test-harness --executable="./my-custom-parser"
```
