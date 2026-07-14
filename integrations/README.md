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
Contains `alp-validate.yml`.
**Usage:** Copy this file to `.github/workflows/alp-validate.yml` in your repository. It will automatically run `alp validate` on every push and pull request, ensuring that your protocol files never contain syntax errors, broken references, or circular dependencies.
