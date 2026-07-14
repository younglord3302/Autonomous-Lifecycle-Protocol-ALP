# Goals

## Protocol Goals

### G1: Machine-Readable by Default
Every ALP file must be parseable by a machine without LLM inference. Natural language descriptions are allowed in `description` fields, but all structural data (dependencies, states, assignments) must be deterministic.

### G2: Tool-Agnostic
ALP must work with any AI agent, any LLM, and any IDE. The protocol must not contain features that only work on a specific platform.

### G3: Schema-Validated
Every ALP object type must have a corresponding JSON Schema. Any ALP file can be validated without executing code.

### G4: Lifecycle-Aware
ALP must track the full lifecycle of software features from ideation through deployment and maintenance.

### G5: Verifiable
Every unit of work in ALP must be verifiable against defined quality gates. "Done" is not a subjective judgment — it's a checkable condition.

### G6: Memory-Persistent
ALP must support structured memory that persists across agent sessions, enabling agents to learn and build on prior work.

### G7: Multi-Agent Ready
ALP must support multiple specialized agents collaborating on the same project with defined roles, permissions, and coordination protocols.

---

## Ecosystem Goals

### E1: Reference Implementation
Ship a TypeScript reference implementation including parser, CLI, and validator within the first year.

### E2: SDK Coverage
Provide official SDKs in TypeScript and Python, with community SDKs in Go, Rust, and Java.

### E3: IDE Integration
Ship a VS Code extension that provides ALP file exploration, dependency visualization, and validation.

### E4: Community Adoption
Publish the specification publicly with an RFC process. Encourage tool vendors (Cursor, Cline, Continue, etc.) to adopt ALP as a portable project format.

### E5: Documentation
Maintain comprehensive documentation including getting started guides, tutorials, specification reference, and migration guides from existing formats (`.cursorrules` → ALP).
