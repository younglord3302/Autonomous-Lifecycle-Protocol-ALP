# Design Principles

These principles guide every design decision in ALP. When in doubt, refer to these.

---

## P1: Protocol Over Product

ALP is a specification, not a tool. We define the *what* (the format), not the *how* (the implementation). Any team should be able to build an ALP-compatible tool without our code.

**Implication:** The specification document is the primary deliverable. CLI, SDKs, and extensions are reference implementations.

## P2: Deterministic Over Heuristic

An ALP file must produce the same parse result regardless of which parser, which LLM, or which platform reads it. No ambiguity. No inference required for structural data.

**Implication:** Structure is strict (typed fields, enums, schemas). Only `description` and `name` fields allow free-form text.

## P3: Explicit Over Implicit

Dependencies, states, assignments, and constraints must be explicitly declared. ALP never "guesses" relationships — they are authored or they don't exist.

**Implication:** No magic defaults for structural relationships. If Task B depends on Task A, there must be a `-> task-a` reference.

## P4: Portable Over Powerful

Given a choice between a feature that works everywhere and a feature that's more powerful but platform-specific, choose portability.

**Implication:** ALP avoids features that require specific runtimes, cloud services, or operating systems.

## P5: Incremental Over All-or-Nothing

ALP must be adoptable gradually. A minimal `.alp/project.alp` file should be useful on its own. You shouldn't need to define every agent, memory type, and workflow before getting value.

**Implication:** Most fields are optional. The minimum valid ALP project is ~5 lines.

## P6: Convention Over Configuration

When a sensible default exists, use it. Reduce the number of decisions a developer must make to get started.

**Implication:** Default lifecycle stages, default file locations (`.alp/`), default agent permissions.

## P7: Composable Over Monolithic

ALP should be composed of small, focused objects that reference each other — not massive configuration files.

**Implication:** Features reference tasks. Tasks reference agents. Agents reference rules. Each object has a single responsibility.

## P8: Verifiable Over Trusting

Work is not complete until verification passes. ALP doesn't trust that an agent "finished" — it checks.

**Implication:** The `@verification` system with quality gates is a core protocol feature, not an add-on.
