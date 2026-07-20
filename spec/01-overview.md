# ALP Specification — Overview

**Version:** 2.0.0
**Status:** Stable
**Date:** 2025-07-14

---

## 1. What Is ALP?

ALP (Autonomous Lifecycle Protocol) is the world's first open protocol specifically designed for autonomous software engineering. It replaces unstructured project documentation (like READMEs, PRDs, and TODO lists) with a deterministic, machine-readable specification.

> **Note:** As of v2.0.0, ALP is in the **Final Release Candidate** phase. The formal grammar is locked and strict semantic versioning guarantees are in effect for production implementations.

ALP files use the `.alp` extension and follow a structured syntax that allows AI agents to:

- Understand a software project without human explanation
- Plan work using structured task graphs
- Execute work following defined workflows
- Track state across sessions
- Store and retrieve memory
- Verify completed work
- Resume interrupted work
- Collaborate with other agents

ALP is **not** a programming language. It is a **protocol format** — a way to describe software projects so that any AI agent can read, understand, and act on them.

---

## 2. Why ALP Exists

### The Problem

Current AI coding workflows rely on unstructured documents:

| Document | Problem |
|---|---|
| `README.md` | Written for humans, not machines |
| `PRD.md` | Free-form text, no standard structure |
| `AGENTS.md` | Platform-specific, not portable |
| `TASKS.md` | No dependency graph, no verification rules |
| `TODO.md` | No lifecycle, no state tracking |
| `Architecture.md` | No machine-readable relationships |

Every AI coding agent must:

1. Read all of these files
2. Infer structure from free-form text
3. Build its own internal model
4. Lose that model when the session ends
5. Rebuild everything from scratch next time

This is wasteful, error-prone, and non-deterministic.

### The Solution

Replace all of these with a single protocol: ALP.

One format. One structure. One lifecycle. One memory model.

Any AI agent that understands ALP can work on any ALP project — without custom prompts, without platform-specific instructions, without re-reading the entire codebase.

---

## 3. Design Principles

### 3.1 Machine First

ALP is designed primarily for autonomous AI agents. Every syntax choice optimizes for parseability, determinism, and machine comprehension.

Humans can read ALP files, but they are not the primary audience.

### 3.2 Deterministic

Same ALP files should produce the same understanding, the same plan, and the same execution order — regardless of which AI agent reads them.

Ambiguity is a bug.

### 3.3 Modular

Every ALP feature is independent. A project can use:
- Only project and task definitions
- Full lifecycle with memory and verification
- Any subset in between

No feature requires another feature unless explicitly specified.

### 3.4 Extensible

The format supports custom object types and custom properties through the **Plugin System**. New protocol objects (e.g., `@epic`, `@sprint`) can be introduced via the `!import` directive and `@type` blocks. Plugins can be loaded locally or dynamically via secure, remote HTTPS URLs, allowing organizations to share standardized methodologies.

### 3.5 Programmable

Starting with v0.3.0, ALP supports the **ALP Expression Language (ALPEL)**. This enables string interpolation (`${expression}`), conditional directives (`!if: expression`), and runtime assertions (`!assert: expression`), making workflows and engine behavior fully dynamic without writing external scripts.

### 3.6 Language Agnostic

ALP describes software projects. It does not care what programming language the project uses. A Python project and a Rust project use the same ALP format.

### 3.6 Framework Agnostic

React, Angular, Vue, Express, Django, Rails — ALP works with any framework. The format describes *what* to build and *how* to verify it, not which tools to use.

### 3.7 Agent Agnostic

Claude, GPT, Gemini, Codex, Cursor, OpenHands, custom agents — any AI system that implements the ALP specification can work with ALP projects.

### 3.8 Stateful

ALP tracks project state persistently. When an agent's session ends, the state is preserved. The next agent (or the same agent in a new session) can resume exactly where work left off.

### 3.9 Verifiable

No task is considered complete until all defined verification rules pass. ALP enforces quality gates at every stage of the lifecycle.

### 3.10 Self-Describing

An ALP project contains everything an agent needs to understand it. No external documentation required. The `.alp/` directory is the single source of truth.

### 3.11 Composable

ALP projects can be composed into larger **Workspaces**. Independent projects remain self-contained, but can declare cross-project dependencies, share agents, and unify their dependency graphs without modifying their internal structure.

---

## 4. Comparison to Existing Formats

| Feature | Markdown (`.md`) | YAML | JSON | ALP (`.alp`) |
|---|---|---|---|---|
| Primary audience | Humans | Config tools | APIs | AI agents |
| Lifecycle support | No | No | No | Yes |
| State tracking | No | No | No | Yes |
| Memory model | No | No | No | Yes |
| Cross-references | No | Limited (`$ref`) | Limited (`$ref`) | Native (`->`) |
| Dependency graph | No | No | No | Native |
| Verification rules | No | No | No | Native |
| Task management | No | No | No | Native |
| Agent model | No | No | No | Native |
| Status indicators | Limited (`- [ ]`) | No | No | Rich (`[ ]`, `[x]`, `[~]`, `[!]`, `[?]`, `[-]`) |

ALP is not a replacement for Markdown, YAML, or JSON. It is a new format purpose-built for a use case none of them address: **autonomous software engineering**.

---

## 5. Scope of This Specification

This specification defines:

- The `.alp` file syntax and grammar
- All 17 core protocol objects
- The project lifecycle model
- The loop, workflow, context, and verification engines
- The memory model
- The dependency graph system
- The agent model
- The plugin system and custom object types
- The plugin registry protocol and dependency resolution
- The expression language (ALPEL)
- Multi-project workspaces (monorepos, remote distributed projects, and cross-workspace networks)
- Dynamic object generation via `@macro`
- Real-time multi-agent concurrency and state locking
- The `.alp/` directory structure convention
- Format versioning rules

This specification does **not** define:

- A parser implementation (language-specific implementations are separate projects)
- A CLI tool
- An SDK
- A web dashboard
- An IDE extension

Those are implementation projects that follow this specification.

---

## 6. Terminology

| Term | Definition |
|---|---|
| **ALP file** | A text file with the `.alp` extension following the ALP syntax |
| **ALP project** | A software project that contains a `.alp/` directory |
| **Protocol object** | A structured data block in an ALP file (e.g., `@project`, `@task`) |
| **Block** | A protocol object instance starting with `@type` |
| **Property** | A `key: value` pair within a block |
| **Reference** | A `-> id` pointer to another protocol object |
| **Directive** | A `!name` instruction that controls agent behavior |
| **Lifecycle** | The stages a feature progresses through |
| **Loop** | An iterative improvement cycle |
| **Memory** | Persistent key-value storage scoped to protocol objects |
| **Verification** | Rules that must pass for work to be considered complete |
| **Agent** | An AI system that reads and acts on ALP files |

---

## 7. Conformance

An ALP-conformant agent MUST:

1. Parse all valid `.alp` files without error
2. Respect the lifecycle stage ordering
3. Resolve all `->` references before executing work
4. Evaluate all `@verify` blocks before marking tasks complete
5. Persist state changes to `.alp/state.alp`
6. Write memory entries to `.alp/memory.alp`
7. Follow dependency ordering when executing tasks
8. Respect agent permissions and limits

An ALP-conformant agent SHOULD:

1. Use the context engine to load only relevant information
2. Record decisions in `@decision` blocks
3. Emit events for state transitions
4. Support the loop engine for iterative improvement
5. Handle interrupted work using checkpoints
