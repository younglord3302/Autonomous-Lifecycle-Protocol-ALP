---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ALP"
  text: "The Autonomous Lifecycle Protocol"
  tagline: "The open standard & execution engine for AI-driven software engineering. Write a machine-readable spec — let your agents plan, build, verify, and remember."
  image:
    src: /alp-logo.png
    alt: ALP Logo
  actions:
    - theme: brand
      text: Get Started
      link: '/guide/cli'
    - theme: alt
      text: View the Spec
      link: '/spec/01-overview'
    - theme: alt
      text: GitHub
      link: 'https://github.com/alp-protocol/alp'
      target: _blank

features:
  - title: Execution Engine (alp run)
    details: Topologically sorts your dependency graph, compiles precise context bundles, and orchestrates agents through the full lifecycle.
  - title: Machine-Readable DAG
    details: Every .alp file parses deterministically into a Directed Acyclic Graph — no LLM inference, no guessing what needs doing.
  - title: Quality Gates (alp verify)
    details: "Tasks aren't 'done' until their verify scripts exit 0. Failures are marked [!] Blocked, halting the engine."
  - title: MCP Server Native
    details: Expose your project's live architecture to Claude Desktop, Cursor, and any MCP client with tools like alp_get_graph.
  - title: VS Code Language Server
    details: IntelliSense, go-to-definition, and rich hover metadata while writing .alp files — a first-class authoring experience.
  - title: Schema-Validated
    details: Every object type ships with a JSON Schema. Any ALP file can be validated without executing a single line of code.
---

<style>
.VPHome h2 {
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 56px 0 20px;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.VPHome blockquote {
  margin: 24px 0;
  padding: 14px 18px;
  border-left: 3px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--vp-c-bg));
  color: var(--vp-c-text-1);
  font-size: 1.02rem;
}

/* Stats band */
.alp-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin: 28px 0 8px;
}
.alp-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 22px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.alp-stat:hover {
  transform: translateY(-4px);
  border-color: var(--vp-c-brand-1);
}
.alp-stat-num {
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.alp-stat-label {
  margin-top: 8px;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
}

/* Ecosystem grid */
.alp-eco {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 20px;
}
.alp-eco-card {
  display: block;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.alp-eco-card:hover {
  transform: translateY(-4px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 10px 30px -12px color-mix(in srgb, var(--vp-c-brand-1) 45%, transparent);
}
.alp-eco-card h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
  color: var(--vp-c-brand-1);
}
.alp-eco-card p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.alp-eco-card code {
  font-size: 0.82em;
}

/* CTA */
.alp-cta {
  margin-top: 64px;
  padding: 40px 28px;
  text-align: center;
  border-radius: 18px;
  background:
    radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent), transparent 60%),
    var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}
.alp-cta h2 {
  margin: 0 0 18px;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.alp-cta-btn {
  display: inline-block;
  padding: 11px 22px;
  border-radius: 10px;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.alp-cta-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px -10px color-mix(in srgb, var(--vp-c-brand-1) 60%, transparent);
}

/* Comparison table */
.alp-compare {
  overflow-x: auto;
  margin: 20px 0 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
}
.alp-compare table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
  min-width: 760px;
}
.alp-compare th,
.alp-compare td {
  padding: 11px 14px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}
.alp-compare thead th {
  background: var(--vp-c-bg-soft);
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.alp-compare tbody tr:last-child td {
  border-bottom: none;
}
.alp-compare tbody tr:hover {
  background: color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent);
}
.alp-compare .alp-col {
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, var(--vp-c-bg));
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.alp-compare thead .alp-col {
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  color: #fff;
}

@media (max-width: 768px) {
  .alp-stats { grid-template-columns: repeat(2, 1fr); }
  .alp-eco { grid-template-columns: 1fr; }
}
</style>

## Why ALP?

> **Git** standardized version control. **Docker** standardized environments. **OpenAPI** standardized APIs.
> **ALP** standardizes how AI builds software.

Today every AI coding assistant (Devin, Claude Code, Cursor, OpenHands) relies on unstructured
prompts and brittle context-scraping. They forget decisions, overwrite each other's work, and lose
track of dependencies. ALP replaces scattered `README.md`, `PRD.md`, `AGENTS.md`, and `TASKS.md`
files with **one deterministic protocol stored natively in your repository** (`.alp/`).

<div class="alp-stats">
  <div class="alp-stat"><span class="alp-stat-num">17</span><span class="alp-stat-label">Core protocol objects</span></div>
  <div class="alp-stat"><span class="alp-stat-num">6</span><span class="alp-stat-label">Lifecycle status states</span></div>
  <div class="alp-stat"><span class="alp-stat-num">2.0.0</span><span class="alp-stat-label">Stable specification</span></div>
  <div class="alp-stat"><span class="alp-stat-num">100%</span><span class="alp-stat-label">Machine-validatable</span></div>
</div>

## How ALP compares to other formats

ALP isn't a replacement for Markdown, YAML, JSON, XML, or TOML — it's a new format purpose-built for
a use case none of them address: **autonomous software engineering**.

<div class="alp-compare">
<table>
  <thead>
    <tr>
      <th>Capability</th>
      <th>Markdown <code>.md</code></th>
      <th>YAML</th>
      <th>JSON</th>
      <th>XML</th>
      <th>TOML</th>
      <th class="alp-col">ALP <code>.alp</code></th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Primary audience</td><td>Humans</td><td>Config tools</td><td>APIs</td><td>Documents</td><td>Config</td><td class="alp-col">AI agents</td></tr>
    <tr><td>Lifecycle support</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Yes</td></tr>
    <tr><td>State tracking</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Yes</td></tr>
    <tr><td>Memory model</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Yes</td></tr>
    <tr><td>Cross-references</td><td>No</td><td>Limited (<code>$ref</code>)</td><td>Limited (<code>$ref</code>)</td><td>XLink / XInclude</td><td>No</td><td class="alp-col">Native (<code>-&gt;</code>)</td></tr>
    <tr><td>Dependency graph</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Native</td></tr>
    <tr><td>Verification rules</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Native</td></tr>
    <tr><td>Task management</td><td>Limited (<code>- [ ]</code>)</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Native</td></tr>
    <tr><td>Agent model</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Native</td></tr>
    <tr><td>Status indicators</td><td>Limited (<code>- [ ]</code>)</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Rich (<code>[ ] [x] [~] [!] [?] [-]</code>)</td></tr>
    <tr><td>Schema validation</td><td>No</td><td>Limited</td><td>Limited</td><td>XSD</td><td>No</td><td class="alp-col">Native (JSON Schema)</td></tr>
    <tr><td>AI-agent native</td><td>No</td><td>No</td><td>No</td><td>No</td><td>No</td><td class="alp-col">Yes</td></tr>
  </tbody>
</table>
</div>

## How it works

ALP parses your project into a **Directed Acyclic Graph**. Agents receive exactly the context they
need, exactly when they need it — and work is only considered complete when quality gates pass.

```alp
@project todo-app {
  description: "A minimal todo application"
  language: typescript
}

@decision use-postgres {
  description: "Persist with PostgreSQL"
}

@task setup-db {
  description: "Provision the database"
  depends_on: use-postgres
  verify: ["npm run db:migrate"]
}

@task build-api {
  description: "Build the REST API"
  depends_on: setup-db
  rule: "no ORMs"
  verify: ["npm test"]
}
```

1. **Describe** — Declare `@project`, `@task`, `@decision`, and `@rule` blocks in your `.alp/` files.
2. **Run** — `alp run` topological-sorts dependencies and pipes a context bundle to your agent.
3. **Verify** — `alp verify` executes each task's `verify` scripts; a `0` exit marks it `[x]`.
4. **Persist** — State and memory are written back to `.alp/`, so the next session resumes cleanly.

```bash
alp run | claude-code
alp verify build-api
```

## The ALP ecosystem

ALP is a complete, production-ready toolbox — not just a spec.

<div class="alp-eco">
  <a class="alp-eco-card" href="/guide/cli"><h3>@alp/cli</h3><p>The terminal interface: <code>run</code>, <code>verify</code>, <code>doctor</code>, <code>lint</code>, <code>export</code>, <code>upgrade</code>.</p></a>
  <a class="alp-eco-card" href="/spec/03-protocol-objects"><h3>@alp/parser</h3><p>Parses <code>.alp</code> files and computes Kahn topological sorts over the dependency graph.</p></a>
  <a class="alp-eco-card" href="/mcp-server"><h3>@alp/mcp-server</h3><p>Real-time MCP integration for Claude Desktop, Cursor, and any compliant client.</p></a>
  <a class="alp-eco-card" href="/vscode-extension"><h3>alp-vscode</h3><p>Language Server with IntelliSense, go-to-definition, and rich hover metadata.</p></a>
  <a class="alp-eco-card" href="/guide/sdk"><h3>@alp/sdk &amp; alp-sdk</h3><p>Official TypeScript and Python SDKs for programmatic access.</p></a>
  <a class="alp-eco-card" href="/spec/16-compliance"><h3>Compliance Suite</h3><p>Schema validation and conformance tests that guarantee "done" is checkable.</p></a>
</div>

## Quick start

```bash
# Install the CLI
npm install -g @alp/cli

# Scaffold a new ALP workspace
alp init --template react

# Start the execution engine
alp run
```

## Design principles

ALP is built on a small set of non-negotiable principles — **Machine-First**, **Deterministic**,
**Modular**, **Extensible** (via the Plugin System & ALPEL), **Language / Framework / Agent Agnostic**,
**Stateful**, **Verifiable**, and **Self-Describing**. One format, one structure, one lifecycle,
one memory model — any conformant agent can work on any ALP project.

<div class="alp-cta">
  <h2>Standardize how your agents build software.</h2>
  <a class="alp-cta-btn" href="/guide/cli">Read the CLI guide →</a>
</div>
