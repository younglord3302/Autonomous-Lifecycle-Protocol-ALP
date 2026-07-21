# ALP Language Server

VS Code extension for the Autonomous Lifecycle Protocol (ALP) v15.2.0.

Provides IntelliSense, Go to Definition, Hover, Diagnostics, Semantic Highlighting, and Rename Refactoring for `.alp` files.

## Quick Start

```bash
npm install
npm run compile
code --install-extension alp-vscode-15.2.0.vsix
```

## Features

- Autocomplete for all 27 core ALP block types and 6 directives
- Go to Definition for `-> id` references
- Hover tooltips for block markers, references, and directives
- Real-time diagnostics (syntax errors, unresolved references, missing status-marker reasons)
- Semantic token highlighting
- Workspace symbol search
- Rename refactoring across the workspace
- Quick fixes for unresolved references

## Development

```bash
npm run watch    # Build in watch mode
npm run compile  # Production build
```
