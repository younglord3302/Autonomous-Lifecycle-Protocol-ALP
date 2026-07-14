# ALP CLI

The `alp` command-line interface for working with ALP projects.

## Planned Commands

| Command | Description |
|---|---|
| `alp init` | Initialize a new ALP project in the current directory |
| `alp validate` | Validate all `.alp` files against schemas |
| `alp lint` | Check for style and convention issues |
| `alp graph` | Visualize the project dependency graph |
| `alp status` | Show project state and progress |
| `alp verify` | Run verification gates on completed tasks |
| `alp run` | Execute a workflow |
| `alp doctor` | Diagnose issues in the ALP project |
| `alp upgrade` | Upgrade ALP files to the latest spec version |
| `alp export` | Export to YAML/JSON format |

## Technology Stack

- **Runtime:** Node.js
- **Framework:** Commander.js or oclif
- **Validation:** Ajv (JSON Schema)
- **Testing:** Vitest

## Status

🔜 **Phase 7** — Not yet started.
