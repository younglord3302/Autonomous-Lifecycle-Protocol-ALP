# ALP SDK

Official SDK packages for integrating ALP into applications. Both the
TypeScript (`@alp/sdk`) and Python (`alp-sdk`) SDKs are shipped and maintained
in parity through the Production-Grade Era (V5, toolchain `8.4.0`).

## SDKs

| Language | Package | Status |
|---|---|---|
| TypeScript | `@alp/sdk` | ✅ Stable (parser ships `@alp/parser`; the `@alp/sdk` umbrella re-exports the engine) |
| Python | `alp-sdk` | ✅ Stable (`pip install alp-sdk`) |
| Go | `alp-go` | 🔜 Community |
| Rust | `alp-rs` | 🔜 Community |
| Java | `alp-java` | 🔜 Community |

## What an SDK Provides

- Parse `.alp` files into typed objects
- Validate objects against JSON Schemas
- Build and traverse the dependency graph
- Policy, scheduling, contract, and vault engines (v8)
- Serialize objects back to `.alp` format
- Export to YAML/JSON
