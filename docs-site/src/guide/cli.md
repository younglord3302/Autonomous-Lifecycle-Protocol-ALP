# ALP Usage Guide

Welcome to the **Autonomous Lifecycle Protocol (ALP)**! ALP is an open standard designed to help AI agents (and human developers) coordinate, track progress, and build software autonomously.

## Installation

The CLI and Parser are distributed via npm:

```bash
npm install -g @alp/cli
```

## Quick Start

### 1. Initialization
To start using ALP in your project, run:

```bash
alp init
```

This creates an `.alp/` directory and a `project.alp` file in your repository.

### 2. Defining Features and Tasks
Create `.alp` files inside your `.alp/` directory. For example, `.alp/features.alp`:

```alp
!alp-version: 3.0.0

@feature
  id: feat-auth
  status: [~]
  description: "User authentication system"
  
---

@task
  id: task-login-ui
  status: [ ]
  feature: -> feat-auth
  priority: high
```

### 3. Validation
Ensure your `.alp` files conform to the strict JSON Schemas of the protocol:

```bash
alp validate
```

### 4. Progress Tracking
Check the current progress of your project based on the `[ ]`, `[~]`, and `[x]` status markers:

```bash
alp status
```

### 5. Dependency Graphs
Visualize the execution order of your tasks and features (resolved via Kahn's topological sort algorithm):

```bash
alp graph
```

## How AI Agents Use ALP

If you are developing an AI agent (like Devin, Claude Code, or an open-source alternative), you should use the `@alp/parser` package to programmatically read and interact with the workspace:

```typescript
import { AlpParser, LoopEngine, AlpGraph } from '@alp/parser';
import * as fs from 'fs';

const parser = new AlpParser();
const content = fs.readFileSync('.alp/features.alp', 'utf8');

// Parse and validate against the official schemas
const objects = parser.parseAndValidate(content);

// Build an execution graph
const graph = new AlpGraph();
graph.buildGraph(objects);

// Get the next blocked task
const executionOrder = graph.topologicalSort();
const nextTask = executionOrder.find(node => node.object.status !== '[x]');
console.log('Agent should work on:', nextTask.id);
```

For more technical details, refer to the [ALP Specification](../spec/01-overview.md).
