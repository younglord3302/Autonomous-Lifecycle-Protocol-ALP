# ALP Integrations

This directory contains drop-in configuration files to integrate the Autonomous Lifecycle Protocol (ALP) with your existing CI/CD pipelines and AI agent tools.

## Available Integrations

### 1. Cursor (`cursor/`)
Contains a `.cursorrules` file. 
**Usage:** Copy `.cursorrules` to the root of your repository. This will instruct the Cursor AI agent on how to read your `.alp` files to gain context, and how to update task statuses as it completes work.

### 2. Claude Code & Cline (`claude-code/`)
Contains `instructions.md`.
**Usage:** Copy these instructions into your agent's system prompt or custom instructions file (e.g., `.claudecode.md`). It teaches CLI-based agents how to use the `@alp/cli` to validate the workspace and view the dependency graph before writing code. In V3, agents drive execution via `alp run` (and `alp run --concurrent N` for swarm mode) and report status with `alp checkpoint` (including `--ask-human` for Human-in-the-Loop review handoffs).

### 3. GitHub Actions (`github/`)
The ALP repo ships an active CI workflow at `.github/workflows/ci.yml` (TypeScript + Python SDK tests and example validation). For your own repositories, copy the drop-in templates from this directory into `.github/workflows/`:
- `alp-validate.yml` runs `alp validate` on every PR/push and fails the check when any `.alp` file is schema-invalid or the dependency graph has cycles — so a broken protocol state can never be merged.
- `alp-sync.yml` tracks PR events and transitions your ALP `.alp` tasks from `[ ]` to `[~]` to `[x]` as PRs are opened and merged.
- `alp-pr-context.yml` posts PR context (linked tasks/decisions) as a comment when a PR is opened.
- `alp-report.yml` publishes a weekly status report of the workspace.

> **CLI install:** the drop-in workflows use `npm install -g @alp/cli`. Until the `@alp/cli` package is published to npm, replace that step with a build-from-source step in your fork: `npm ci && npm run build --workspace @alp/cli`, then invoke the CLI via `node cli/dist/index.js`. This matches the `validate` job in the repo's own `.github/workflows/ci.yml`.

## The Production-Grade Era (V5 — v8.0.0 → v9.0.0)

Integrations should be aware of the v8 governance surface so agents operate
with verifiable least privilege:

- **`alp policy`** enforces path/command guardrails, time-windows (`allow_during`), human approval (`require_approval`), and signed proposals (`--proposal` / `--trust`). Wire `alp policy --path` / `--command` as a pre-execution gate in CI.
- **`alp schedule`** evaluates `@timeline` cron / `at` triggers so agents can discover deferred work without an external cron daemon.
- **`alp vault`** stores encrypted secrets (X25519 envelope + AES-256-GCM); CI should inject secrets via `alp vault get` rather than committing them.
- **Breaking (v8.0.0):** `@type` is the canonical plugin marker (`@type_definition` is deprecated), `!assert` is fail-closed, and `[!]`/`[?]` status markers must carry a free-text reason. See `docs-site/MIGRATION-v8.md`.

### 4. Model Context Protocol (`mcp-server/`)
ALP provides a native MCP server (`@alp/mcp-server`) that enables any modern AI IDE (Claude Desktop, Cursor, Windsurf) to securely query the ALP workspace.
**Usage:** Start the server using `alp-mcp` or configure your IDE's MCP settings to point to the `@alp/mcp-server` executable. Agents can then use tools like `alp_get_graph`, `alp_get_status`, `alp_read_object`, `alp_list_objects`, `alp_validate`, `alp_update_status`, `alp_get_impact`, and `alp_search` natively.
