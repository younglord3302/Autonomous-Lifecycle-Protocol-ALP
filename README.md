<div align="center">
  <img src="branding/alp-logo.png" alt="ALP Logo" width="150" />
  <br/>
  <h1>Autonomous Lifecycle Protocol (ALP)</h1>
  <p><b>The open standard and execution engine for Autonomous Software Engineering.</b></p>
  <br/>

  [![Status](https://img.shields.io/badge/status-stable-success.svg)](#)
  [![Version](https://img.shields.io/badge/version-4.4.0-blue.svg)](#)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](#)
</div>

<br/>

> **Git** standardized version control.  
> **Docker** standardized environments.  
> **OpenAPI** standardized APIs.  
> **ALP** standardizes how AI builds software.

Currently, every AI coding assistant (Devin, Claude Code, Cursor, OpenHands) relies on unstructured prompts and brittle context-gathering. They forget decisions, overwrite each other's work, and fail to track complex dependencies. 

**ALP is a machine-readable coordination layer stored directly in your repository (`.alp/`).** It provides a universal standard for tracking architecture, decisions, and tasks, alongside a powerful **Execution Engine** to orchestrate it all.

---

## 🆚 Why ALP? (Comparison)

How does ALP compare to traditional workflows and AI tools?

| Feature | Traditional Workflow (Jira / Linear) | Current AI Tools (Cursor, Claude) | The ALP Standard |
| :--- | :--- | :--- | :--- |
| **Location** | External SaaS (Siloed) | Scrapes `.md` files blindly | Native `.alp/` files in the repo |
| **State Tracking** | Human-updated tickets | AI guesses what needs to be done | Machine-enforced Directed Acyclic Graph |
| **Context** | Lost in Slack / Confluence | Context window gets polluted | Precise `alp run` Context Bundles |
| **Execution** | Manual assignment | Auto-executes blindly | `alp verify` enforces Quality Gates |
| **Tooling** | Web UI only | Proprietary IDEs | Open Ecosystem (CLI, LSP, MCP) |

---

## 🧠 How it Works

ALP parses your project into a **Directed Acyclic Graph (DAG)**. Agents only receive the exact context they need, exactly when they need it.

```mermaid
graph TD
    subgraph "Your Repository (.alp/)"
        D[Decision: Use PostgreSQL] --> T1[Task: Setup DB]
        T1 --> T2[Task: Build API]
        R[Rule: No ORMs] --> T2
    end
    
    subgraph "Execution Engine (alp run)"
        T2 --> |Context Bundle| C[Claude/Cursor Agent]
    end

    subgraph "Quality Gates (alp verify)"
        C --> |npm test| V{Tests Pass?}
        V --> |Yes| X(Mark [x] Done)
        V --> |No| B(Mark [!] Blocked)
    end
```

---

## 🚀 The ALP Ecosystem

ALP is not just a specification. It is a complete, production-ready ecosystem of tools designed to manage autonomous workflows.

### 1. The Execution Engine (`alp run`)
ALP parses your `.alp` files into a Dependency Graph. Run `alp run` to automatically topological-sort your dependencies and compile highly optimized **Context Bundles**.

You can execute natively with an LLM:
```bash
alp run --provider openai --model gpt-4o
```
Or pipe the context bundle to your preferred agent:
```bash
alp run | claude-code
```
This pipes the exact state of the project, relevant decisions, rules, and cross-session memories directly into your agent, ensuring zero hallucinations.

### 2. Verification & Quality Gates (`alp verify`)
An AI shouldn't mark a task as done unless it proves it works. 
```bash
alp verify task-auth
```
This command automatically executes the shell scripts defined in your task's `verify` array. If they exit `0`, the task is marked `[x]`. If they fail, the task is marked `[!]` (Blocked), stopping the Execution Engine from proceeding.

### 3. Model Context Protocol Server (`@alp/mcp-server`)
Natively expose your project's architecture to Claude Desktop and Cursor. Agents can use tools like `alp_get_graph` and `alp_read_object` to query your repository's state in real time before writing a single line of code.

### 4. VS Code Language Server (`alp-vscode`)
Writing `.alp` files is a first-class experience. Install the packaged VS Code extension to get:
- **IntelliSense**: Autocomplete IDs and directives.
- **Go to Definition**: Jump directly to task or decision definitions across files.
- **Rich Hover**: View task descriptions, status, and metadata instantly.
- **Rename & Semantic Tokens**: Fully colored syntax and workspace-wide refactoring.

### 5. Package Registry & Marketplace (`alp registry`) — *V4 Pillar 3*
Share and reuse autonomous knowledge. Publish your own packages, host a
registry, and install community templates with integrity-checked, semver-pinned
downloads:
```bash
alp install @community/scrum-master      # install (latest)
alp registry publish ./my-pack           # publish to the local store
alp serve --registry                     # host a registry over HTTP
alp registry install @community/scrum-master@^1.0.0 --url http://127.0.0.1:4000
```

### 6. Live State Server (`alp serve`) — *new in 3.1*
Watch your swarm work in real time. `alp serve` runs a zero-dependency local
dashboard (HTTP + Server-Sent Events) that tails the structured runtime log and
streams task claims, status changes, and human handoffs to your browser.
```bash
alp serve --port 4000
```

### 7. Self-Evolving Protocol (`alp evolve`) — *new in 3.1*
Let the protocol learn from failure. `alp evolve` analyzes runtime telemetry to
find tasks that repeatedly fail or escalate to a human, then proposes new
`@rule` safety checks for your review.
```bash
alp evolve --apply   # writes proposals to .alp/evolved.alp
```

---

## 📦 Packages

| Package | Description |
|---|---|
| [`@alp/cli`](cli/) | The terminal interface (`run`, `serve`, `evolve`, `policy`, `verify`, `checkpoint`, `doctor`, `lint`, `export`, `upgrade`) |
| [`@alp/parser`](parser/) | The engine for parsing `.alp` files and managing Kahn's Topological sort |
| [`@alp/mcp-server`](mcp-server/) | The MCP server for IDE and Agent integrations |
| [`@alp/vscode`](vscode/) | The official VS Code extension |
| [`@alp/sdk`](sdk/) | The TypeScript SDK for programmatic access |
| [`alp-sdk`](sdk/python/) | The Python SDK native implementation |
| [`docs-site`](docs-site/) | The official VitePress documentation site |

---

## 🛠️ Quick Start

Install the CLI globally:
```bash
npm install -g @alp/cli
```

Initialize a new ALP workspace in your repository:
```bash
alp init --template react
```

Start the Execution Engine:
```bash
alp run
```

---

## 📖 Documentation

- **[Official Documentation Site](docs-site/)**: Read the guides on the Execution Engine and MCP Integrations.
- **[Vision & Manifesto](docs/VISION.md)**: Why ALP exists.
- **[Formal Specification](spec/01-overview.md)**: The technical protocol definitions.

## 🤝 Contributing

We welcome contributions from researchers and engineers building the next generation of AI agents. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

ALP is open-source and released under the MIT License.
