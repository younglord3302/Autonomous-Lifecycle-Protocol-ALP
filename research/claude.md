# Research — Claude Code (CLAUDE.md)

## What Is CLAUDE.md?

`CLAUDE.md` is a convention used by Claude Code (Anthropic's CLI coding agent) to provide project-level instructions. When Claude Code starts a session, it reads `CLAUDE.md` from the project root to understand coding conventions, project structure, and behavioral guidelines.

## Key Design Decisions

| Decision | Claude Code's Approach |
|---|---|
| Format | Free-form Markdown |
| Schema | None — unstructured natural language |
| Scope | Project root + nested directories |
| Tooling | Built into Claude Code only |
| Portability | Not portable (though the Markdown is readable by any agent) |

## What CLAUDE.md Gets Right

1. **Hierarchical context.** `CLAUDE.md` files can exist at different directory levels, allowing context to be scoped (project-wide rules in root, module-specific rules in subdirectories). ALP mirrors this with its `.alp/` directory structure.
2. **Developer familiarity.** Using Markdown means zero learning curve. Any developer can write a `CLAUDE.md` in seconds.
3. **Natural language flexibility.** Developers can describe complex architectural decisions, edge cases, and preferences in prose.

## What CLAUDE.md Gets Wrong

1. **No deterministic parsing.** The agent must use LLM inference to extract instructions from prose. This means the same `CLAUDE.md` may be interpreted differently across sessions or models.
2. **No lifecycle management.** `CLAUDE.md` says "here's what the project is" but not "here's what needs to be built next" or "here's what's already done."
3. **No dependency graph.** No way to express that Task B depends on Task A, or that Feature X requires Features Y and Z.
4. **No verification.** No quality gates, no automated testing requirements, no acceptance criteria.
5. **No state persistence.** Claude Code doesn't track what it completed in previous sessions. Every new session starts from scratch.
6. **Vendor lock-in.** While any agent *can* read Markdown, `CLAUDE.md` is specifically designed for Claude Code's behavior model.

## How ALP Supersedes CLAUDE.md

| CLAUDE.md | ALP Equivalent |
|---|---|
| "This project uses React with TypeScript" | `@context` block with architecture details |
| "Always use functional components" | `@rule` object with enforceable validation |
| "Don't modify the auth module" | `@constraint` with `blocked_directories` |
| "The database schema is in /db/" | `@resource` pointing to schema files |
| (not possible) | Task graphs, lifecycle states, agent memory |

## Conclusion

`CLAUDE.md` demonstrates that AI coding agents need structured project context. But Markdown is the wrong format for machine consumption — it's ambiguous, unvalidatable, and platform-specific. ALP provides the deterministic, schema-validated, portable alternative.
