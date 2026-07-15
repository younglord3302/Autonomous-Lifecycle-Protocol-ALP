# Roadmap

## Current Status: Version 1.0.0 Complete! 🎉

The protocol specification, parser, CLI, VS Code extension, documentation, and SDKs have all been completed and released as v1.0.0.

---

## Phase 0 — Research ✅
Competitive analysis of OpenAPI, MCP, Cursor Rules, Claude Code, and the agentic coding landscape. Documented why ALP fills a real gap.

## Phase 1 — Define ALP ✅
Vision, mission, problems, goals, principles, and roadmap documents.

## Phase 2 — Protocol Design ✅
18 core protocol objects fully specified with fields, relationships, and validation rules.

## Phase 3 — Repository Structure ✅
Clean directory layout with spec, research, docs, examples, tests, and scaffold for future packages.

## Phase 4 — Protocol Specification ✅
16-document formal specification covering syntax, objects, lifecycle, engines, memory, agents, plugins, expressions, multi-project workspaces, formal grammar, and compliance.

---

## Phase 5 — File Format ✅
**Decision:** Custom `.alp` syntax as primary format. YAML/JSON as export targets.

**Status:** The `.alp` syntax is defined with a formal EBNF grammar.

## Phase 6 — Schema Definitions ✅
**Target:** Generate JSON Schema files for all 22 protocol objects.

**Deliverables:**
- `schemas/project.schema.json`
- `schemas/task.schema.json`
- `schemas/feature.schema.json`
- `schemas/workflow.schema.json`
- `schemas/agent.schema.json`
- ... (22 total)

## Phase 7 — CLI ✅
**Target:** Build the `alp` CLI using TypeScript + Commander.js.

**Commands:** `alp init`, `alp validate`, `alp graph`, `alp status`

## Phase 8 — Parser ✅
**Target:** TypeScript parser that reads `.alp` files, validates schemas, builds an in-memory graph, resolves references, detects cycles, and reports errors.

## Phase 9 — Graph Engine ✅
**Target:** Represent the project as a directed acyclic graph. Enable dependency resolution, impact analysis, and parallel execution planning.

## Phase 10 — Loop Engine ✅
**Target:** Implement the core innovation: iterative improvement loops (Observe → Understand → Plan → Execute → Test → Review → Reflect → Improve → Repeat).

## Phase 11 — Memory Engine ✅
**Target:** Implement structured memory with retrieval, updates, summarization, and history.

## Phase 12 — Agent Framework ✅
**Target:** Define agent capabilities, permissions, tools, responsibilities, and outputs for all standard roles.

## Phase 13 — Verification Engine ✅
**Target:** Implement quality gates (unit tests, integration tests, linting, security, accessibility, performance, documentation).

## Phase 14 — VS Code Extension ✅
**Target:** ALP explorer, dependency graph visualization, workflow viewer, state panel, validation, quick actions.

## Phase 15 — Playground ✅
**Target:** Browser-based playground for creating, validating, and visualizing ALP projects.

## Phase 16 — SDKs ✅
**Target:** TypeScript and Python SDKs, with community expansions for Go, Rust, and Java.

## Phase 17 — Documentation Site ✅
**Target:** VitePress site with getting started guides, spec reference, tutorials, examples, and migration guides.

## Phase 18 — Integrations ✅
**Target:** GitHub Actions, Cursor, Claude Code, Cline.

## Phase 19 — Community ✅
**Target:** GitHub repository, website, Discord, RFC process, contribution guidelines.

## Phase 20 — Version 1.0 ✅
**Requirements:** Stable specification, CLI, parser, SDKs, documentation, reference implementation, example projects, test suite.

---

## Estimated Timeline

| Phase | Duration | Status |
|---|---|---|
| Research | 2 weeks | ✅ Complete |
| Protocol Design | 2 weeks | ✅ Complete |
| Specification | 2 weeks | ✅ Complete |
| Schemas | 1 week | ✅ Complete |
| Parser | 2 weeks | ✅ Complete |
| CLI | 2 weeks | ✅ Complete |
| Loop Engine | 3 weeks | ✅ Complete |
| Memory Engine | 2 weeks | ✅ Complete |
| Graph Engine | 2 weeks | ✅ Complete |
| VS Code Extension | 2 weeks | ✅ Complete |
| Playground | 2 weeks | ✅ Complete |
| Documentation | 2 weeks | ✅ Complete |
| V1.0.0 Release | 1 week | ✅ Complete |

**MVP Target:** Schemas + Parser + CLI (`alp init`, `alp validate`) + Graph Engine + Documentation + Example Projects.
