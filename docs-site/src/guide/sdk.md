# ALP SDK

Official SDK packages for integrating ALP into applications.

## Available SDKs

| Language | Package | Status |
|---|---|---|
| TypeScript | `@alp/sdk` | ✅ Shipped (parsing, validation, graph) |
| Python | `alp-sdk` | ✅ Shipped (parsing, validation, analytics, registry client) |
| Go | `alp-go` | 🔜 Community |
| Rust | `alp-rs` | 🔜 Community |
| Java | `alp-java` | 🔜 Community |

## TypeScript

```ts
import { AlpWorkspace } from '@alp/sdk';

const ws = new AlpWorkspace();
ws.load('./my-project');
console.log(ws.getGraph());
```

## Python

```python
from alp_sdk import load_workspace, validate_object, compute_analytics, RegistryClient

# Parse + validate a workspace
objects = load_workspace("./my-project")
for obj in objects:
    validate_object(obj._type, obj.properties)

# Install a package from a hosted registry (V4 Pillar 3)
client = RegistryClient("http://127.0.0.1:4000")
client.install("@community/scrum-master", ".alp", "^1.0.0")

# Run every task's quality gates (mirrors `alp verify`, non-mutating)
report = verify_workspace("./my-project")
print(report["passed"], [(t["id"], t["verified"]) for t in report["tasks"]])
```

## What an SDK Provides

- Parse `.alp` files into typed objects
- Validate objects against JSON Schemas
- Build and traverse the dependency graph
- Compute swarm analytics (`compute_analytics`)
- Talk to a hosted registry (`RegistryClient`: list/search/install, integrity, `.alprc` routing, bearer auth)
- Verify a workspace's quality gates (`verify_workspace`) without mutating `.alp` files
- Export to YAML/JSON
