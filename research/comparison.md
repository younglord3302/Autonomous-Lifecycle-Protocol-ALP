# Research — Competitive Comparison

## Why ALP Should Exist

This document synthesizes the research from individual analyses into a single comparison proving that ALP fills a real, unaddressed gap in the autonomous software engineering ecosystem.

---

## The Protocol Stack for Autonomous Development

```
┌─────────────────────────────────────────┐
│         Developer / Product Owner       │
├─────────────────────────────────────────┤
│    ALP — Project Understanding Layer    │  ← THIS IS THE GAP
│    Goals, Tasks, Dependencies, Memory   │
├─────────────────────────────────────────┤
│    MCP — Tool Communication Layer       │
│    File I/O, Search, Database, Deploy   │
├─────────────────────────────────────────┤
│    LLM — Intelligence Layer             │
│    GPT, Claude, Gemini, Llama           │
├─────────────────────────────────────────┤
│    IDE / Runtime Environment            │
│    VS Code, Terminal, Docker, Cloud     │
└─────────────────────────────────────────┘
```

**The gap:** There is no standard for the "Project Understanding Layer." Every tool builds its own, incompatible solution.

---

## Feature Comparison Matrix

| Capability | OpenAPI | MCP | Cursor Rules | CLAUDE.md | Cline | Roo Code | Codex | Aider | **ALP** |
|---|---|---|---|---|---|---|---|---|---|
| Machine-readable format | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Formal schema/grammar | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Project lifecycle tracking | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Dependency graphs | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Verification / quality gates | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Persistent memory | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-agent orchestration | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ✅ |
| Tool-agnostic / portable | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| State persistence across sessions | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Plugin / extension system | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## The Analogy

| Domain | Before Standard | Standard | After Standard |
|---|---|---|---|
| Version Control | Manual file copies, custom scripts | **Git** | Universal version control |
| Containers | Custom VM images, snowflake servers | **Docker** | Portable containerization |
| APIs | Custom docs, Markdown, Word docs | **OpenAPI** | Universal API description |
| AI Tool Communication | Custom JSON, ad-hoc protocols | **MCP** | Universal tool connectivity |
| AI Project Understanding | `.cursorrules`, `CLAUDE.md`, `AGENTS.md` | **ALP** | Universal project protocol |

---

## Key Insights

### 1. The market is fragmented by design
Every AI coding tool has an incentive to create proprietary context formats. This keeps users locked in. ALP breaks this cycle by providing a neutral, open standard.

### 2. Markdown is the wrong format
Every current solution uses free-form Markdown because it's easy. But Markdown is inherently ambiguous — the same text can be interpreted differently by different models. ALP provides deterministic, schema-validated structure.

### 3. Lifecycle is the killer feature
No existing tool tracks the lifecycle of software features from ideation through verification. ALP's 7-stage lifecycle with dependency resolution and verification gates is genuinely novel.

### 4. Memory persistence is undervalued
Current agents lose all context between sessions. ALP's memory model ensures that architectural decisions, discovered bugs, and learned patterns persist indefinitely.

### 5. Multi-agent is the future
As AI systems grow more capable, single-agent architectures will give way to specialized multi-agent teams. ALP is designed from the ground up for this future.

---

## Conclusion

ALP should exist because:

1. **No standard exists** for describing software projects to AI agents.
2. **Every tool reinvents** the same fragmented, incompatible solution.
3. **The gap is at the protocol level**, not the tool level.
4. **History shows** that open standards (Git, Docker, OpenAPI, MCP) win when they fill a genuine interoperability gap.

ALP is positioned to become the Git of autonomous software development — the universal protocol that every AI coding tool adopts because the alternative (proprietary fragmentation) is unsustainable.
