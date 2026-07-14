# Research — Agentic Coding Tools Landscape

## Overview

This document analyzes the current landscape of autonomous and semi-autonomous coding tools: OpenHands, Devin, Aider, Continue.dev, Cline, Roo Code, and Codex. Each represents a different approach to AI-assisted development, but they all share a common limitation that ALP addresses.

---

## Tool Analysis

### OpenHands (formerly OpenDevin)
- **What it is:** An open-source platform for autonomous AI software agents.
- **How it works:** Spins up a sandboxed environment where an AI agent can write code, run commands, and browse the web.
- **Project understanding:** Reads files directly. No structured project format.
- **Limitation:** The agent must rediscover the project's architecture, goals, and state every session. No persistent memory or lifecycle tracking.

### Devin (Cognition)
- **What it is:** The first commercial "AI software engineer." An autonomous agent that can plan, code, debug, and deploy.
- **How it works:** Uses its own internal planning system to break down tasks.
- **Project understanding:** Proprietary. Devin builds its own internal model.
- **Limitation:** Completely opaque. You can't inspect, modify, or port Devin's understanding of your project. Vendor lock-in at its most extreme.

### Aider
- **What it is:** An open-source CLI tool for pair programming with LLMs.
- **How it works:** Works within git repositories. Sends file contents to LLMs with editing instructions.
- **Project understanding:** Uses a "repo map" (tree-sitter based code analysis) to understand code structure.
- **Limitation:** Repo maps are code-level, not project-level. No concept of features, business goals, or verification. Single-session only.

### Continue.dev
- **What it is:** An open-source IDE extension (VS Code, JetBrains) for AI code assistance.
- **How it works:** Provides chat, autocomplete, and inline editing powered by various LLMs.
- **Project understanding:** Uses `.continue/config.json` for agent configuration. Context is gathered from open files and codebase indexing.
- **Limitation:** Configuration is tool-specific. No project lifecycle, no task management, no inter-agent coordination.

### Cline
- **What it is:** An autonomous coding agent that runs inside VS Code.
- **How it works:** Reads your project files, proposes changes, executes commands with user approval.
- **Project understanding:** `.clinerules` files for project-specific instructions (similar to Cursor Rules).
- **Limitation:** Rules are unstructured Markdown. No schema, no lifecycle, no verification gates.

### Roo Code
- **What it is:** A fork/extension of Cline with enhanced capabilities (multi-mode agents).
- **How it works:** Defines "modes" (Code, Architect, Ask, Debug) with different system prompts.
- **Project understanding:** `.roo/rules-*` files for mode-specific instructions.
- **Limitation:** Instructions are still free-form text. Modes are predefined, not customizable through a protocol.

### OpenAI Codex
- **What it is:** OpenAI's cloud-based autonomous coding agent.
- **How it works:** Runs in a sandboxed environment. Reads your repository, makes changes, and creates PRs.
- **Project understanding:** Reads `AGENTS.md` and `README.md` for project context.
- **Limitation:** Relies on unstructured Markdown. No schema validation, no dependency graphs, no persistent state across tasks.

---

## The Common Problem

Every tool listed above suffers from the **same fundamental limitation:**

> There is no standard, machine-readable format for describing a software project's goals, architecture, tasks, dependencies, and quality requirements to an AI agent.

Each tool invents its own solution:
| Tool | Context File | Format | Portable? |
|---|---|---|---|
| Cursor | `.cursorrules` | Markdown | ❌ |
| Claude Code | `CLAUDE.md` | Markdown | ❌ |
| Cline | `.clinerules` | Markdown | ❌ |
| Roo Code | `.roo/rules-*` | Markdown | ❌ |
| Codex | `AGENTS.md` | Markdown | ❌ |
| Continue | `.continue/config.json` | JSON | ❌ |
| Devin | (internal) | Proprietary | ❌ |
| OpenHands | (none) | N/A | N/A |
| Aider | (repo map) | Auto-generated | ❌ |

**None of them are interoperable.** Writing `.cursorrules` doesn't help if you switch to Claude Code. Training Devin's internal model doesn't help if you switch to OpenHands.

---

## Why ALP Solves This

ALP provides the **universal, portable, machine-readable protocol** that every tool needs but none have built:

| Problem | ALP Solution |
|---|---|
| No standard format | The `.alp/` directory with a formal EBNF grammar |
| No dependency graphs | `@dependency` objects with typed references |
| No lifecycle tracking | 7-stage lifecycle with state transitions |
| No verification | `@verification` with quality gates |
| No persistent memory | `@memory` with scoped retrieval |
| No multi-agent support | `@agent` with roles, permissions, and orchestration |
| Vendor lock-in | Protocol-level standard, tool-agnostic |

## Conclusion

The agentic coding landscape is fragmented. Every tool reinvents project understanding from scratch using unstructured Markdown. ALP is the missing protocol layer — a universal standard that *any* tool can adopt, just like OpenAPI became the universal standard for APIs.
