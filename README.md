# Autonomous Lifecycle Protocol (ALP)

**Version 1.0.0 (MVP)**

[![Status](https://img.shields.io/badge/status-stable-success.svg)](#)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

ALP is the world's first open protocol for Autonomous Software Engineering. 

Just as Git standardized version control and Docker standardized containers, **ALP standardizes how AI agents build software**.

## 📖 Quick Links

- [Usage Guide](docs/USAGE.md) - Get started with ALP in your projects
- [Vision & Manifesto](docs/VISION.md) - Why ALP exists
- [Formal Specification](spec/01-overview.md) - The technical protocol definitions
- [Architecture Schemas](schemas/README.md) - JSON Schemas for validation

## 🚀 What is ALP?

Currently, every AI coding assistant (Devin, Claude Code, OpenHands, etc.) relies on unstructured text prompts and fragmented context gathering to understand a codebase. 

ALP provides a **machine-readable coordination layer** stored directly in the repository (`.alp/`). It provides a universal standard for:

1. **State:** What is being built right now?
2. **Context:** What architectural decisions have been made?
3. **Coordination:** How do multiple specialized agents communicate without losing context?
4. **Memory:** How do agents remember things across sessions?

## 📦 Packages

ALP provides the following reference implementations:

| Package | Description |
|---|---|
| `@alp/schemas` | The official JSON Schema definitions for all 21 ALP protocol objects |
| `@alp/parser` | The TypeScript engine for reading `.alp` files, building dependency graphs, and managing execution loops |
| `@alp/cli` | The terminal interface (`alp init`, `alp validate`, `alp graph`, `alp status`) |

## 🛠️ Installation

```bash
npm install -g @alp/cli
```

*See the [Usage Guide](docs/USAGE.md) for full commands and Node.js API integration.*

## 🤝 Contributing

We welcome contributions from researchers and engineers building the next generation of AI agents. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

ALP is open-source and released under the MIT License.
