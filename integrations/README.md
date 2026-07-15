# ALP Integrations

This directory contains drop-in configuration files to integrate the Autonomous Lifecycle Protocol (ALP) with your existing CI/CD pipelines and AI agent tools.

## Available Integrations

### 1. Cursor (`cursor/`)
Contains a `.cursorrules` file. 
**Usage:** Copy `.cursorrules` to the root of your repository. This will instruct the Cursor AI agent on how to read your `.alp` files to gain context, and how to update task statuses as it completes work.

### 2. Claude Code & Cline (`claude-code/`)
Contains `instructions.md`.
**Usage:** Copy these instructions into your agent's system prompt or custom instructions file (e.g., `.claudecode.md`). It teaches CLI-based agents how to use the `@alp/cli` to validate the workspace and view the dependency graph before writing code.

### 3. GitHub Actions (`github/`)
Contains `alp-validate.yml` and `alp-sync.yml`.
**Usage:** Copy these files to `.github/workflows/` in your repository. 
- `alp-validate.yml` will automatically run `alp validate` on every push and pull request, ensuring that your protocol files never contain syntax errors, broken references, or circular dependencies.
- `alp-sync.yml` tracks PR events and automatically transitions your ALP `.alp` tasks from `[ ]` to `[~]` to `[x]` as PRs are opened and merged.

### 4. Model Context Protocol (`mcp-server/`)
ALP provides a native MCP server (`@alp/mcp-server`) that enables any modern AI IDE (Claude Desktop, Cursor, Windsurf) to securely query the ALP workspace.
**Usage:** Start the server using `alp-mcp` or configure your IDE's MCP settings to point to the `@alp/mcp-server` executable. Agents can then use tools like `alp_get_graph` and `alp_get_status` natively.
