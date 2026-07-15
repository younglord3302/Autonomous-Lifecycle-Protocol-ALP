# VS Code Extension (Language Server)

Writing `.alp` files by hand is fast, but it's even faster with proper IDE support. 

ALP provides a dedicated **Language Server Protocol (LSP)** implementation for Visual Studio Code via the `alp-vscode` extension.

## Features

- **IntelliSense Autocompletion**: Type `@` to instantly see all available ALP object markers (e.g., `@task`, `@agent`). Type `-> ` in any reference field to get an autocomplete dropdown of every ID in your workspace.
- **Go to Definition**: Command-click (or Ctrl-click) on any dependency reference (e.g., `-> dec-database`) to instantly jump your editor to the exact file and line where that object is defined.
- **Hover Metadata**: Hover over any `-> id` reference to pop up a rich tooltip containing the object's description, status, and type without leaving your current file.
- **Real-time Diagnostics**: Syntax errors and schema violations are highlighted with red squigglies directly in your editor as you type.

## Installation

The extension is bundled as a standard `.vsix` file.

1. Download the latest `alp-vscode-2.0.0.vsix` release from the repository.
2. Open VS Code.
3. Open the Extensions View (`Ctrl+Shift+X` or `Cmd+Shift+X`).
4. Click the `...` menu in the top right of the extensions view.
5. Select **Install from VSIX...**
6. Select the downloaded `.vsix` file.

Alternatively, you can install it via the CLI:
```bash
code --install-extension alp-vscode-2.0.0.vsix
```

## How it works

The extension operates as an IPC-based Language Server. Every time you save an `.alp` file, the server scans the `.alp/` directory, updates an internal index of `SymbolEntries`, and provides hyper-fast resolution for autocomplete and hover requests across the entire workspace graph.
