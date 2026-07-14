# Research — OpenAPI

## What Is OpenAPI?

OpenAPI (formerly Swagger) is the industry standard for describing HTTP APIs. It provides a machine-readable specification (YAML or JSON) that defines endpoints, request/response schemas, authentication, and error codes.

## Key Design Decisions

| Decision | OpenAPI's Approach |
|---|---|
| Format | YAML or JSON |
| Schema | JSON Schema (draft-07+) |
| Tooling | Massive ecosystem: Swagger UI, code generators, validators |
| Adoption | Near-universal for REST APIs |
| Governance | OpenAPI Initiative (Linux Foundation) |

## What ALP Borrows from OpenAPI

1. **Schema-first design.** OpenAPI proved that defining the contract *before* the implementation leads to better software. ALP applies this principle to the entire software lifecycle, not just APIs.
2. **Machine-readable specification.** OpenAPI's core insight is that if a machine can read the spec, you can auto-generate documentation, SDKs, and validation. ALP extends this to project management, agent orchestration, and verification.
3. **Versioning strategy.** OpenAPI uses semver and provides clear backwards-compatibility rules. ALP's versioning spec (10-versioning.md) follows a nearly identical model.

## Where ALP Diverges

1. **Scope.** OpenAPI describes *APIs*. ALP describes *entire software projects* — their goals, architecture, tasks, agents, memory, and lifecycle.
2. **Audience.** OpenAPI is written by humans for humans (and machines). ALP is written primarily for AI agents, with human readability as a secondary concern.
3. **Lifecycle awareness.** OpenAPI is static — it describes what an API *is*. ALP is dynamic — it describes what a project *should become* and tracks progress toward that state.
4. **No execution model.** OpenAPI has no concept of "running" a spec. ALP has engines (Loop, Workflow, Context, Verification) that actively drive software development.

## Conclusion

OpenAPI validates ALP's approach: schema-first, machine-readable protocols create enormous ecosystem value. But OpenAPI stops at the API boundary. ALP extends the same philosophy to the entire autonomous software engineering lifecycle.
