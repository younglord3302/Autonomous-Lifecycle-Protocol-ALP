# Research — Cursor Rules

## What Are Cursor Rules?

Cursor Rules are configuration files (`.cursor/rules` or `.cursorrules`) that provide instructions to the Cursor IDE's AI agent. They tell the agent how to behave when generating code for a specific project — coding style, preferred frameworks, naming conventions, and architectural patterns.

## Key Design Decisions

| Decision | Cursor's Approach |
|---|---|
| Format | Free-form Markdown (`.mdc` files) |
| Schema | None — unstructured natural language |
| Scope | Project-level and global settings |
| Tooling | Built into Cursor IDE only |
| Portability | Not portable to other tools |

## What Cursor Rules Get Right

1. **Project-specific agent instructions.** The core insight is correct: AI agents need project context to generate good code. A React project needs different instructions than a Django project.
2. **Low barrier to entry.** Writing a `.cursorrules` file is as easy as writing a README. No schema, no validation, just Markdown.
3. **Community adoption.** Thousands of projects now include Cursor Rules, proving demand for project-level agent configuration.

## What Cursor Rules Get Wrong

1. **No schema.** Rules are free-form text. An agent must infer structure from natural language, which is inherently lossy and non-deterministic.
2. **Platform lock-in.** Cursor Rules only work in Cursor. They don't work in VS Code, Windsurf, Claude Code, Cline, or any other agent platform.
3. **No lifecycle.** Rules describe *how* to code, but not *what* to build. There's no concept of features, tasks, dependencies, or progress tracking.
4. **No verification.** There's no way to define quality gates or ensure that generated code meets specific criteria.
5. **No memory.** Rules are stateless. The agent doesn't remember what it learned from previous sessions.
6. **No multi-agent support.** Rules assume a single agent. There's no way to define specialized agents or orchestrate collaboration.

## How ALP Supersedes Cursor Rules

| Cursor Rules | ALP Equivalent |
|---|---|
| Coding style instructions | `@rule` objects with enforceable constraints |
| Framework preferences | `@context` blocks with architecture definitions |
| "Don't do X" instructions | `@constraint` objects with validation |
| Project description | `@project` with structured fields |
| (not possible) | Dependency graphs, lifecycle tracking, verification |

ALP doesn't just *instruct* agents — it *orchestrates* them. An `.alp/` directory replaces `.cursorrules` while adding everything that's missing: structured tasks, dependency resolution, persistent memory, and automated verification.

## Conclusion

Cursor Rules proved that developers want to configure AI agents per-project. ALP takes this further by replacing unstructured instructions with a deterministic, portable, and verifiable protocol that works with *any* agent platform.
