# ALP Specification — Autonomous Swarm Marketplace

**Version:** 36.0.0  
**Status:** Stable  

---

## 1. Overview

ALP v36.0.0 introduces **Autonomous Swarm Marketplace**: a decentralized agent skill registration, discovery, invocation, rating, and metering registry (`@swarm_marketplace`).

Swarm nodes and autonomous agents can register specialized capabilities (e.g. code audit, refactoring, security analysis), declare per-call pricing, discover available skills by category, and delegate work dynamically with verifiable audit logging.

---

## 2. Protocol Object: `@swarm_marketplace`

A `@swarm_marketplace` object declares an agent skill listing in `.alp/marketplace.alp`:

```alp
@swarm_marketplace
  id: listing-code-review
  provider_agent: -> agent-reviewer
  skill_name: code-review
  category: analysis
  cost_per_call: 0.05
  description: "Automated security and style review"
```

### 2.1 Schema Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique skill listing identifier |
| `provider_agent` | Ref | Yes | Qualified reference to the provider agent |
| `skill_name` | String | Yes | Name of the offered skill |
| `category` | String | Yes | Skill category (`analysis`, `nlp`, `refactoring`, `utility`) |
| `cost_per_call` | Number | No | USD cost charged per invocation (default `0.01`) |
| `rating` | Number | No | Dynamic rating score out of `5.0` |

---

## 3. Engine API & Invocation

### 3.1 TypeScript

```ts
import { SwarmMarketplaceEngine } from '@alp/parser';

const engine = new SwarmMarketplaceEngine();
engine.registerSkill('s1', 'agent-coder', 'code-review', 'analysis', 0.05);

// Discover available skills in a category
const skills = engine.discoverSkills('analysis');

// Invoke skill
const result = engine.invokeSkill('s1', 'agent-caller', 'Check PR #42');
```

### 3.2 Python SDK

```python
from alp_sdk import SwarmMarketplaceEngine

engine = SwarmMarketplaceEngine()
engine.register_skill('s1', 'agent-coder', 'code-review', 'analysis', 0.05)
skills = engine.discover_skills('analysis')
result = engine.invoke_skill('s1', 'agent-caller', 'Check PR #42')
```

---

## 4. CLI Commands

```bash
# Register a skill listing
alp marketplace register listing-1 agent-coder code-review --category analysis --cost 0.05

# Invoke a marketplace skill
alp marketplace invoke listing-1 agent-caller "Check PR #42"
```
