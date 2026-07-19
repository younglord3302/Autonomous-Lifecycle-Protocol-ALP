# ALP Parser

The reference parser implementation for the `.alp` file format.

## Responsibilities

1. **Lexical analysis** — Tokenize `.alp` files (indentation, block markers, properties, references)
2. **Syntactic parsing** — Build an Abstract Syntax Tree (AST) from tokens
3. **Schema validation** — Validate objects against JSON Schema definitions
4. **Reference resolution** — Resolve `-> id` references to their target objects
5. **Graph construction** — Build an in-memory dependency graph
6. **Cycle detection** — Identify and report circular dependencies
7. **Error reporting** — Provide line/column-level error messages

## Technology Stack

- **Language:** TypeScript
- **Testing:** Vitest
- **Grammar:** W3C EBNF (defined in spec/15-formal-grammar.md)

## Status

✅ **Stable** — reference parser for the ALP `.alp` format, part of the
Production-Grade Era (V5) toolchain (`8.4.0`).
