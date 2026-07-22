# VS Code Extension (Language Server)

Writing `.alp` files by hand is fast, but it's even faster with proper IDE support.

ALP provides a dedicated **Language Server Protocol (LSP)** implementation for Visual Studio Code via the `alp-vscode` extension.

## Features

- **IntelliSense Autocompletion**: Type `@` to instantly see all available ALP object markers (e.g., `@task`, `@agent`, `@policy`, `@contract`, `@vault`, `@plan`, `@lesson`, `@offer`, `@trace`, `@migration`). Type `-> ` in any reference field to get an autocomplete dropdown of every ID in your workspace.
- **Interactive Webview DAG Visualizer**: Click the `$(graph) ALP DAG` status bar item or run `ALP: Show Interactive DAG Visualizer` (`alp.showVisualizer`) to open an in-editor Webview visualizer displaying status-colored cards (`[x]`, `[~]`, `[!]`, `[?]`, `[ ]`), object type badges, and workspace metrics side-by-side with your `.alp` files.
- **Go to Definition**: Command-click (or Ctrl-click) on any dependency reference (e.g., `-> dec-database`) to instantly jump your editor to the exact file and line where that object is defined.
- **Hover Metadata**: Hover over any `-> id` reference to pop up a rich tooltip containing the object's description, status, and type without leaving your current file. Hover over block markers and directives for inline documentation.
- **Real-time Diagnostics**: Syntax errors, schema violations, and V9+ status-marker errors (missing reasons for `[!]` and `[?]`) are highlighted with red squigglies directly in your editor as you type.
- **Semantic Highlighting**: Block markers, properties, directives, references, and status markers are color-coded for fast visual scanning.
- **Workspace Symbols**: Browse all objects across your `.alp/` workspace with the VS Code "Go to Symbol in Workspace" command.
- **Rename Refactoring**: Rename any object ID and have all references updated across the entire workspace.
- **Code Actions**: Quick fixes for unresolved references with similarity-based suggestions.

## Installation

The extension is bundled as a standard `.vsix` file.

1. Download the latest `alp-vscode-15.2.0.vsix` release from the repository.
2. Open VS Code.
3. Open the Extensions View (`Ctrl+Shift+X` or `Cmd+Shift+X`).
4. Click the `...` menu in the top right of the extensions view.
5. Select **Install from VSIX...**
6. Select the downloaded `.vsix` file.

Alternatively, you can install it via the CLI:
```bash
code --install-extension alp-vscode-15.2.0.vsix
```

## Supported Block Types (V15.2.0)

The extension provides hover documentation and autocomplete for all 27 core ALP block types:

| Category | Block Types |
|---|---|
| **Core** | `@project`, `@task`, `@feature`, `@workflow`, `@agent` |
| **Knowledge** | `@memory`, `@state`, `@artifact`, `@context` |
| **Planning** | `@goal`, `@plan`, `@rule`, `@constraint`, `@decision` |
| **Execution** | `@event`, `@resource`, `@verification`, `@dependency` |
| **Governance** | `@policy`, `@contract`, `@vault`, `@timeline` |
| **Extensibility** | `@plugin`, `@type`, `@macro`, `@package` |
| **Runtime** | `@repo`, `@swarm`, `@offer`, `@trace`, `@migration` |
| **Learning** | `@lesson` |

## Supported Directives

| Directive | Description |
|---|---|
| `!alp-version` | Declares the ALP specification version |
| `!import` | Imports another `.alp` file or remote URL |
| `!deprecated` | Marks an object as deprecated with migration note |
| `!assert` | Boolean precondition that must hold (fail-closed since V9) |
| `!if` | Conditionally includes the next object based on ALPEL expression |
| `!integrity` | SHA-256 integrity hash for remote imports |

## How it works

The extension operates as an IPC-based Language Server. Every time you save an `.alp` file, the server scans the `.alp/` directory, updates an internal index of `SymbolEntries`, and provides hyper-fast resolution for autocomplete and hover requests across the entire workspace graph.
