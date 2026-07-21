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

### V12–V14 Additions

```python
from alp_sdk.cost_optimizer import CostEstimator, CostOptimizer, AutoScaleRecommendation
from alp_sdk.predictive_policy import PredictivePolicyEngine, AnomalyScore, BaselineProfile
from alp_sdk.healing import HealingEngine, HealingReport, HealingAction, HealingStrategy, CircuitBreaker
from alp_sdk.resilience import ResilientSwarm, ResilienceReport, AgentNode, TaskAssignment, QuorumConsensus
from alp_sdk.trace import TraceEntry, TraceStore, MerkleTree, verify_trace_integrity
from alp_sdk.bridge import ProtocolBridge, SUPPORTED_FORMATS, BridgeExportResult, BridgeImportResult
from alp_sdk.identity import AgentIdentity, VerifiablePresentation, TrustRegistry, IdentityResolver, AgentKeyStore, generateKeypair, createDid
from alp_sdk.p2p import P2PSwarm, P2PNode, GossipMessage, GossipProtocol, DHT, P2PReport, TaskAssignment
from alp_sdk.tenant import TenantVault, TenantContext, TenantManager, TenantIsolationError, create_tenant_key
from alp_sdk.governance import PolicyBallot, GovernanceEngine, BallotRecord, GovernanceReport, Vote, VoteValue
from alp_sdk.domain_trust import DomainTrustAnchor, DomainTrustManager, TrustRoot, DomainLink, TrustStatus, create_domain_keypair
```

| Module | Version | Description |
| :--- | :--- | :--- |
| `cost_optimizer` | `16.0.0` | Predicts execution cost and emits optimization plans (parallelization, caching, agent reassignment) |
| `predictive_policy` | `16.0.0` | Confidence scoring and anomaly detection for policy decisions |
| `healing` | `16.0.0` | Self-healing workflows: `HealingEngine` auto-recovers from failures using strategies |
| `resilience` | `16.0.0` | Swarm resilience with quorum consensus and circuit breakers |
| `trace` | `16.0.0` | Immutable execution traces with Merkle-tree integrity verification |
| `bridge` | `17.0.0` | Bidirectional ALP ↔ OpenAPI/GraphQL/gRPC/AsyncAPI adapter |
| `identity` | `18.0.0` | W3C DID-based agent identity, trust registry, and verifiable presentations |
| `p2p` | `18.1.0` | Decentralized P2P swarm coordination with gossip and DHT discovery |
| `tenant` | `18.2.0` | Multi-tenant workspace isolation with cryptographic sealing |
| `governance` | `18.3.0` | Agent voting on policy changes with quorum enforcement |
| `domain_trust` | `18.4.0` | Cross-domain trust bootstrapping via signed trust roots |

## What an SDK Provides

- Parse `.alp` files into typed objects
- Validate objects against JSON Schemas
- Build and traverse the dependency graph
- Compute swarm analytics (`compute_analytics`)
- Talk to a hosted registry (`RegistryClient`: list/search/install, integrity, `.alprc` routing, bearer auth)
- Verify a workspace's quality gates (`verify_workspace`) without mutating `.alp` files
- Export to YAML/JSON
