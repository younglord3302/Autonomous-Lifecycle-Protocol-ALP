#!/usr/bin/env node

/**
 * ALP MCP Server
 *
 * Exposes the ALP workspace to any MCP-compatible client (Claude Desktop,
 * Cursor, etc.) via standardized tool calls over stdio transport.
 *
 * Tools provided:
 *   - alp_get_graph: Returns the full dependency graph as JSON
 *   - alp_get_status: Returns project status summary
 *   - alp_read_object: Read a specific ALP object by ID
 *   - alp_list_objects: List all objects, optionally filtered by type
 *   - alp_validate: Validate the workspace and return any errors
 *   - alp_update_status: Update the status of a specific task
 *   - alp_get_impact: Get all downstream nodes affected by a change
 *   - alp_search: Fuzzy search across all object IDs and descriptions
 *   - alp_delegate: Create a new task assigned to a specific role/agent
 *   - alp_decompose: Split a large task into sub-tasks
 *   - alp_create_task: Create a new task .alp file
 *   - alp_create_feature: Create a new feature .alp file
 *   - alp_get_events: Read recent runtime events with filtering
 *   - alp_get_analytics: Return analytics summary from state store
 *   - alp_set_status: Update an object's status via MCP
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  PromptSchema,
  PromptArgumentSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AlpParser, AlpObject, AlpGraph, PolicyEngine, updateObjectStatus } from '@alp/parser';
import * as fs from 'fs';
import * as path from 'path';

/** Convert an arbitrary title into a kebab-case ALP object id. */
function toKebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// ─── Workspace Loader ─────────────────────────────────────────────────────
function loadWorkspace(rootDir: string): AlpObject[] {
  const alpDir = path.join(rootDir, '.alp');
  if (!fs.existsSync(alpDir)) {
    return [];
  }
  const parser = new AlpParser();
  const objects: AlpObject[] = [];
  loadDirectory(alpDir, parser, objects);
  return objects;
}

function loadDirectory(dir: string, parser: AlpParser, results: AlpObject[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadDirectory(fullPath, parser, results);
    } else if (entry.name.endsWith('.alp')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        results.push(...parser.parse(content));
      } catch {
        // Skip unparseable files
      }
    }
  }
}

/**
 * Policy gate for MCP mutation tools (v4 Pillar 4 — Capability Scoping).
 *
 * Evaluates a proposed workspace file write against any @policy objects.
 * Returns an MCP error result when a strict policy blocks it, or null when
 * the action is permitted. The path is made workspace-relative (POSIX) so it
 * matches policy globs like "src/**" or ".alp/**".
 */
function enforcePolicy(
  rootDir: string,
  targetFile: string,
  agent?: string,
): { content: { type: 'text'; text: string }[]; isError: true } | null {
  const objects = loadWorkspace(rootDir);
  const engine = new PolicyEngine(objects);
  if (engine.count === 0) return null;

  const relative = path
    .relative(rootDir, targetFile)
    .replace(/\\/g, '/');

  // ALP protocol-coordination files under `.alp/` (task creation via
  // delegate/decompose, status updates) are governed by explicit deny rules
  // only — they are not "source code" subject to the allow-list. This lets a
  // policy like allow_paths: [src/**] coexist with normal swarm coordination
  // while still honoring deny_paths (e.g. ".alp/.runtime/**").
  const isProtocolFile = relative === '.alp' || relative.startsWith('.alp/');
  if (isProtocolFile) {
    const denyOnly = engine.evaluateDenyOnly({ kind: 'path', value: relative, agent });
    if (denyOnly.blocked) {
      return {
        content: [
          {
            type: 'text',
            text:
              `⛔ Policy denied: cannot modify '${relative}'.\n` +
              denyOnly.reasons.join('\n'),
          },
        ],
        isError: true,
      };
    }
    return null;
  }

  const decision = engine.evaluate({ kind: 'path', value: relative, agent });

  if (decision.blocked) {
    return {
      content: [
        {
          type: 'text',
          text:
            `⛔ Policy denied: cannot modify '${relative}'.\n` +
            decision.reasons.join('\n'),
        },
      ],
      isError: true,
    };
  }
  return null;
}

/**
 * Append an audit event to `.alp/.runtime/log.jsonl` (v4 Pillar 4 — Audit
 * Trail). Mirrors the CLI runtime event format so `alp serve` shows MCP
 * mutations alongside swarm activity. Best-effort; never throws.
 */
function audit(
  rootDir: string,
  type: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const runtimeDir = path.join(rootDir, '.alp', '.runtime');
    if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      source: 'mcp-server',
      pid: process.pid,
      ...fields,
    };
    fs.appendFileSync(
      path.join(runtimeDir, 'log.jsonl'),
      JSON.stringify(entry) + '\n',
      'utf-8',
    );
  } catch {
    /* audit is best-effort */
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────
const server = new Server(
  { name: 'alp-mcp-server', version: '10.4.0' },
  { capabilities: { tools: {}, resources: { subscribe: true }, prompts: {} } }
);

// ─── Resource Subscription State ─────────────────────────────────────────
const subscribers = new Map<string, Set<(uri: string) => void>>();
let subscriptionTimer: NodeJS.Timeout | null = null;
let lastEventLogSize = 0;

function getResourceUri(resourcePath: string): string {
  return `file://${resourcePath.replace(/\\/g, '/')}`;
}

function startSubscriptionPolling(rootDir: string) {
  if (subscriptionTimer) return;
  const logPath = path.join(rootDir, '.alp', '.runtime', 'log.jsonl');
  const eventsPath = path.join(rootDir, '.alp', '.events', 'events.jsonl');

  subscriptionTimer = setInterval(() => {
    try {
      let newEvents = false;
      if (fs.existsSync(eventsPath)) {
        const { size } = fs.statSync(eventsPath);
        if (size > lastEventLogSize) {
          lastEventLogSize = size;
          newEvents = true;
        }
      }
      if (fs.existsSync(logPath)) {
        const { size } = fs.statSync(logPath);
        if (size > lastEventLogSize) {
          lastEventLogSize = size;
          newEvents = true;
        }
      }
      if (newEvents && subscribers.size > 0) {
        for (const [, callbacks] of subscribers) {
          for (const cb of callbacks) {
            try { cb('alp://events'); } catch { /* best-effort */ }
          }
        }
      }
    } catch {
      /* best-effort polling */
    }
  }, 2000);
}

function stopSubscriptionPolling() {
  if (subscriptionTimer) {
    clearInterval(subscriptionTimer);
    subscriptionTimer = null;
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'alp_list_objects',
      description: 'List all ALP objects in the workspace, optionally filtered by type (e.g., task, agent, memory).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', description: 'Filter by object type (e.g., "task", "agent", "memory")' },
          cwd: { type: 'string', description: 'Working directory (defaults to process.cwd())' },
        },
      },
    },
    {
      name: 'alp_read_object',
      description: 'Read a specific ALP object by its ID and return all its properties.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The ID of the object to read' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['id'],
      },
    },
    {
      name: 'alp_get_graph',
      description: 'Get the full dependency graph of the ALP workspace as a sorted execution order.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cwd: { type: 'string', description: 'Working directory' },
        },
      },
    },
    {
      name: 'alp_get_status',
      description: 'Get the current project status, including task counts by state.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cwd: { type: 'string', description: 'Working directory' },
        },
      },
    },
    {
      name: 'alp_validate',
      description: 'Validate the ALP workspace and return any syntax or schema errors.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cwd: { type: 'string', description: 'Working directory' },
        },
      },
    },
    {
      name: 'alp_update_status',
      description: 'Update the status of a specific task in the ALP workspace',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status (e.g. [ ], [~], [x], [!])' },
          agent: { type: 'string', description: 'Optional acting agent (for @policy scoping)' },
          cwd: { type: 'string' }
        },
        required: ['id', 'status']
      }
    },
    {
      name: 'alp_get_impact',
      description: 'Get all downstream nodes affected by a change to the given node',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Node ID' },
          cwd: { type: 'string' }
        },
        required: ['id']
      }
    },
    {
      name: 'alp_search',
      description: 'Fuzzy search across all object IDs and descriptions',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          cwd: { type: 'string' }
        },
        required: ['query']
      }
    },
    {
      name: 'alp_delegate',
      description: 'Create a new task assigned to a specific role/agent (sub-agent delegation).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Task title (used to derive the task id)' },
          agent: { type: 'string', description: 'Agent/role to assign (e.g. agent-qa)' },
          description: { type: 'string', description: 'Optional task description' },
          parent: { type: 'string', description: 'Optional parent task id this delegates from' },
          cwd: { type: 'string' }
        },
        required: ['title']
      }
    },
    {
      name: 'alp_decompose',
      description: 'Split a large task into sub-tasks, each blocked by the parent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          taskId: { type: 'string', description: 'Parent task id to decompose' },
          subtasks: { type: 'array', items: { type: 'string' }, description: 'Sub-task titles' },
          agent: { type: 'string', description: 'Optional acting agent (for @policy scoping)' },
          cwd: { type: 'string' }
        },
        required: ['taskId', 'subtasks']
      }
    },
    {
      name: 'alp_create_task',
      description: 'Create a new task .alp file in .alp/tasks/ with given title, description, and agent assignment.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Task title (used to derive the task id)' },
          description: { type: 'string', description: 'Optional task description' },
          agent: { type: 'string', description: 'Agent/role to assign (e.g. agent-qa)' },
          parent: { type: 'string', description: 'Optional parent task id' },
          status: { type: 'string', description: 'Initial status: [ ], [~], [x], [!], [?] (default [ ])' },
          cwd: { type: 'string' }
        },
        required: ['title']
      }
    },
    {
      name: 'alp_create_feature',
      description: 'Create a new feature .alp file in .alp/features/ with given title and description.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Feature title (used to derive the feature id)' },
          description: { type: 'string', description: 'Optional feature description' },
          status: { type: 'string', description: 'Initial status: [ ], [~], [x], [!], [?] (default [ ])' },
          cwd: { type: 'string' }
        },
        required: ['title']
      }
    },
    {
      name: 'alp_get_events',
      description: 'Read recent events from .alp/.events/events.jsonl with optional type filtering and limit.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', description: 'Filter by event type (e.g. status_changed, object_created)' },
          limit: { type: 'number', description: 'Maximum number of events to return (default 50)' },
          cwd: { type: 'string' }
        },
        required: []
      }
    },
    {
      name: 'alp_get_analytics',
      description: 'Read analytics summary from .alp/.runtime/state.db.json or compute from events.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cwd: { type: 'string' }
        },
        required: []
      }
    },
    {
      name: 'alp_set_status',
      description: 'Update the status of an ALP object (task, feature, etc.) by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Object ID to update' },
          status: { type: 'string', description: 'New status: [ ], [~], [x], [!], [?]' },
          cwd: { type: 'string' }
        },
        required: ['id', 'status']
      }
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const cwd = (args?.cwd as string) || process.cwd();

  switch (name) {
    case 'alp_list_objects': {
      const objects = loadWorkspace(cwd);
      const typeFilter = args?.type as string | undefined;
      const filtered = typeFilter
        ? objects.filter((o) => o._type === typeFilter)
        : objects;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              filtered.map((o) => ({ type: o._type, id: o.id || 'unnamed' })),
              null,
              2
            ),
          },
        ],
      };
    }

    case 'alp_read_object': {
      const objects = loadWorkspace(cwd);
      const targetId = args?.id as string;
      const obj = objects.find((o) => o.id === targetId);
      if (!obj) {
        return {
          content: [{ type: 'text', text: `Error: Object "${targetId}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
      };
    }

    case 'alp_get_graph': {
      const objects = loadWorkspace(cwd);
      const graph = new AlpGraph();
      graph.buildGraph(objects);
      
      try {
        const order = graph.topologicalSort();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                order.map((o) => ({ type: o.type, id: o.id || 'unnamed' })),
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Graph Error: ${err.message}` }],
          isError: true,
        };
      }
    }

    case 'alp_get_status': {
      const objects = loadWorkspace(cwd);
      const statusCounts: Record<string, number> = {
        done: 0,
        in_progress: 0,
        todo: 0,
        blocked: 0,
      };
      for (const obj of objects) {
        if (obj.status === '[x]') statusCounts.done++;
        else if (obj.status === '[~]') statusCounts.in_progress++;
        else if (obj.status === '[ ]') statusCounts.todo++;
        else if (obj.status === '[!]') statusCounts.blocked++;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { total_objects: objects.length, status: statusCounts },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'alp_validate': {
      const alpDir = path.join(cwd, '.alp');
      if (!fs.existsSync(alpDir)) {
        return {
          content: [{ type: 'text', text: 'Error: .alp directory not found.' }],
          isError: true,
        };
      }
      const errors: string[] = [];
      validateDirectory(alpDir, errors);
      if (errors.length === 0) {
        return {
          content: [{ type: 'text', text: '✅ All ALP files are valid.' }],
        };
      }
      return {
        content: [{ type: 'text', text: errors.join('\n') }],
        isError: true,
      };
    }
    
    case 'alp_update_status': {
      const targetId = args?.id as string;
      const newStatus = args?.status as string;
      const agent = args?.agent as string | undefined;
      const alpDir = path.join(cwd, '.alp');
      let updated = false;
      let policyError: ReturnType<typeof enforcePolicy> = null;
      const walk = (dir: string) => {
        if (updated || policyError) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (updated || policyError) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else if (fullPath.endsWith('.alp')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(`id: ${targetId}`)) {
              // Capability scoping: the file about to be written must comply.
              policyError = enforcePolicy(cwd, fullPath, agent);
              if (policyError) return;
              // Quote-aware status rewrite (preserves [ ], [~], [x], [!], [?]).
              const { content: next, changed } = updateObjectStatus(content, targetId, newStatus);
              if (changed) {
                fs.writeFileSync(fullPath, next, 'utf8');
                updated = true;
              }
            }
          }
        }
      };
      if (fs.existsSync(alpDir)) walk(alpDir);

      if (policyError) return policyError;

      if (updated) {
        audit(cwd, 'task_status', { task_id: targetId, status: newStatus, agent });
      }
      return {
        content: [{ type: 'text', text: updated ? `Status of ${targetId} updated to ${newStatus}` : `Task ${targetId} not found` }]
      };
    }

    case 'alp_get_impact': {
      const objects = loadWorkspace(cwd);
      const graph = new AlpGraph();
      graph.buildGraph(objects);
      const targetId = args?.id as string;
      const impacted = graph.getImpact(targetId);
      return {
        content: [{ type: 'text', text: JSON.stringify(impacted.map(i => ({ id: i.id, type: i.type })), null, 2) }]
      };
    }

    case 'alp_search': {
      const objects = loadWorkspace(cwd);
      const query = (args?.query as string).toLowerCase();
      const results = objects.filter(o => 
        (o.id && o.id.toLowerCase().includes(query)) ||
        (o.description && o.description.toLowerCase().includes(query))
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(results.map(r => ({ id: r.id, type: r._type, description: r.description })), null, 2) }]
      };
    }

    case 'alp_decompose': {
      // Split a large task into N sub-tasks, each blocked by the parent.
      const parentId = args?.taskId as string;
      const subtasks = (args?.subtasks as string[] | undefined) || [];
      if (!parentId) {
        return { content: [{ type: 'text', text: 'Error: taskId is required.' }], isError: true };
      }
      if (subtasks.length === 0) {
        return { content: [{ type: 'text', text: 'Error: at least one subtask title is required.' }], isError: true };
      }
      const alpDir = path.join(cwd, '.alp');
      const tasksDir = path.join(alpDir, 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });

      const created: string[] = [];
      for (const title of subtasks) {
        const id = toKebab(`${parentId}-${title}`);
        const file = path.join(tasksDir, `${id}.alp`);
        if (fs.existsSync(file)) continue;
        // Capability scoping: the new file path must comply with policy.
        const denied = enforcePolicy(cwd, file, args?.agent as string | undefined);
        if (denied) return denied;
        const body =
          `!alp-version: 3.0.0\n\n` +
          `@task\n` +
          `  id: ${id}\n` +
          `  status: [ ]\n` +
          `  description: "${title.replace(/"/g, "'")}"\n` +
          `  depends_on:\n    - -> ${parentId}\n`;
        fs.writeFileSync(file, body, 'utf8');
        created.push(id);
      }
      if (created.length) {
        audit(cwd, 'file_mutation', { action: 'decompose', parent: parentId, created });
      }
      return {
        content: [{
          type: 'text',
          text: created.length
            ? `Decomposed ${parentId} into ${created.length} sub-task(s): ${created.join(', ')}`
            : `No new sub-tasks created (already exist).`,
        }],
      };
    }

    case 'alp_delegate': {
      // Create a new task assigned to a specific role/agent.
      const title = args?.title as string;
      const agent = (args?.agent as string) || 'agent-developer';
      const description = (args?.description as string) || title || '';
      const parent = args?.parent as string | undefined;
      if (!title) {
        return { content: [{ type: 'text', text: 'Error: title is required.' }], isError: true };
      }
      const alpDir = path.join(cwd, '.alp');
      const tasksDir = path.join(alpDir, 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });

      const id = toKebab(title);
      const file = path.join(tasksDir, `${id}.alp`);
      if (fs.existsSync(file)) {
        return { content: [{ type: 'text', text: `Task ${id} already exists.` }], isError: true };
      }
      // Capability scoping: the new file path must comply with policy.
      const delegateDenied = enforcePolicy(cwd, file, agent);
      if (delegateDenied) return delegateDenied;
      const ownerLine = `  owner: -> ${agent.replace(/^->\s*/, '')}\n`;
      const parentLine = parent ? `  depends_on:\n    - -> ${parent.replace(/^->\s*/, '')}\n` : '';
      const body =
        `!alp-version: 2.0.0\n\n` +
        `@task\n` +
        `  id: ${id}\n` +
        `  status: [ ]\n` +
        `  description: "${description.replace(/"/g, "'")}"\n` +
        ownerLine +
        parentLine;
      fs.writeFileSync(file, body, 'utf8');
      audit(cwd, 'file_mutation', { action: 'delegate', task_id: id, agent });
      return {
        content: [{ type: 'text', text: `Delegated task ${id} to ${agent}.` }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ─── Prompt Handlers ───────────────────────────────────────────────────────
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'triage',
      description: 'Analyze the current project state and suggest a triage plan for blocked and high-priority tasks.',
      arguments: [
        { name: 'focus', description: 'Optional focus area (e.g. "blocked", "critical")', required: false },
      ],
    },
    {
      name: 'standup',
      description: 'Generate a daily standup summary from recent task activity and status changes.',
      arguments: [
        { name: 'since', description: 'ISO timestamp to filter events from (e.g. "2026-07-20T00:00:00Z")', required: false },
      ],
    },
    {
      name: 'retrospective',
      description: 'Generate a sprint retrospective summary from completed tasks, failures, and handoffs.',
      arguments: [
        { name: 'sprint', description: 'Sprint identifier or date range', required: false },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name;
  const args = request.params.arguments || {};
  const objects = loadWorkspace(args.cwd as string || process.cwd());

  switch (promptName) {
    case 'triage': {
      const focus = (args.focus as string) || '';
      const blocked = objects.filter((o) => o.status === '[!]');
      const critical = objects.filter((o) => (o as any).priority === 'critical');
      const todo = objects.filter((o) => o.status === '[ ]');
      let lines = [
        '# Triage Report',
        '',
        `Total objects: ${objects.length}`,
        `Blocked: ${blocked.length}`,
        `Todo: ${todo.length}`,
        `Critical priority: ${critical.length}`,
        '',
      ];
      if (focus) {
        lines.push(`## Focus: ${focus}`);
        if (focus === 'blocked') {
          for (const b of blocked.slice(0, 10)) {
            lines.push(`- **${b.id}**: ${b.description || '(no description)'}`);
          }
        } else if (focus === 'critical') {
          for (const c of critical.slice(0, 10)) {
            lines.push(`- **${c.id}**: ${c.description || '(no description)'}`);
          }
        }
      } else {
        lines.push('## Blocked Tasks');
        if (blocked.length === 0) lines.push('No blocked tasks.');
        else for (const b of blocked.slice(0, 10)) lines.push(`- **${b.id}**: ${b.description || '(no description)'}`);
        lines.push('');
        lines.push('## Next Available');
        for (const t of todo.slice(0, 5)) lines.push(`- **${t.id}**: ${t.description || '(no description)'}`);
      }
      return {
        messages: [
          { role: 'user', content: { type: 'text', text: lines.join('\n') } },
        ],
      };
    }

    case 'standup': {
      const since = (args.since as string) || new Date(Date.now() - 86400000).toISOString();
      const eventsPath = path.join(args.cwd as string || process.cwd(), '.alp', '.runtime', 'log.jsonl');
      let recent: any[] = [];
      if (fs.existsSync(eventsPath)) {
        const raw = fs.readFileSync(eventsPath, 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            if (evt.timestamp >= since) recent.push(evt);
          } catch { /* skip */ }
        }
      }
      const taskStatusChanges = recent.filter((e) => e.type === 'task_status');
      const claims = recent.filter((e) => e.type === 'task_claim');
      const completions = recent.filter((e) => e.type === 'task_status' && e.status === '[x]');
      const lines = [
        '# Daily Standup',
        '',
        `Period: ${since} to now`,
        '',
        `## Activity`,
        `- Events: ${recent.length}`,
        `- Claims: ${claims.length}`,
        `- Status changes: ${taskStatusChanges.length}`,
        `- Completions: ${completions.length}`,
        '',
        '## Recent Status Changes',
        ...taskStatusChanges.slice(-10).map((e) => `- **${e.task_id || 'unknown'}**: ${e.status || ''} (${e.agent || 'unknown agent'})`),
        '',
        '## Completed Tasks',
        ...completions.slice(-10).map((e) => `- **${e.task_id}**`),
      ];
      return {
        messages: [
          { role: 'user', content: { type: 'text', text: lines.join('\n') } },
        ],
      };
    }

    case 'retrospective': {
      const eventsPath2 = path.join(args.cwd as string || process.cwd(), '.alp', '.runtime', 'log.jsonl');
      let allEvents: any[] = [];
      if (fs.existsSync(eventsPath2)) {
        const raw = fs.readFileSync(eventsPath2, 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { allEvents.push(JSON.parse(trimmed)); } catch { /* skip */ }
        }
      }
      const completed = allEvents.filter((e) => e.type === 'task_status' && e.status === '[x]');
      const failed = allEvents.filter((e) => e.type === 'task_status' && e.status === '[!]');
      const handoffs = allEvents.filter((e) => e.type === 'human_handoff' || (e.type === 'task_status' && e.status === '[?]'));
      const failedTasks = [...new Set(failed.map((e) => e.task_id).filter(Boolean))];
      const handoffTasks = [...new Set(handoffs.map((e) => e.task_id).filter(Boolean))];
      const lines2 = [
        '# Sprint Retrospective',
        '',
        `Total events analyzed: ${allEvents.length}`,
        '',
        '## Summary',
        `- Completed: ${completed.length}`,
        `- Failed: ${failed.length}`,
        `- Human handoffs: ${handoffs.length}`,
        '',
        '## Failure Hotspots',
        ...failedTasks.map((tid) => `- **${tid}**`),
        '',
        '## Handoff Points',
        ...handoffTasks.map((tid) => `- **${tid}**`),
        '',
        '## Recommendations',
        ...failedTasks.length
          ? ['- Review failed tasks for common blockers.', '- Consider breaking down large tasks.']
          : ['- No failures detected. Good momentum!'],
        ...handoffs.length
          ? ['- Reduce human handoffs by clarifying task acceptance criteria.']
          : [],
      ];
      return {
        messages: [
          { role: 'user', content: { type: 'text', text: lines2.join('\n') } },
        ],
      };
    }

    default:
      return {
        messages: [{ role: 'user', content: { type: 'text', text: `Prompt "${promptName}" not found.` } }],
        isError: true,
      };
  }
});

// ─── Resource Subscription Handlers ───────────────────────────────────────
server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (!subscribers.has(uri)) {
    subscribers.set(uri, new Set());
  }
  subscribers.get(uri)!.add(() => {});
  startSubscriptionPolling(process.cwd());
  return {};
});

server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  const uri = request.params.uri;
  const cbs = subscribers.get(uri);
  if (cbs) {
    cbs.clear();
    subscribers.delete(uri);
  }
  if (subscribers.size === 0) {
    stopSubscriptionPolling();
  }
  return {};
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function validateDirectory(dir: string, errors: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const parser = new AlpParser();
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      validateDirectory(fullPath, errors);
    } else if (entry.name.endsWith('.alp')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        parser.parseAndValidate(content);
      } catch (err: any) {
        errors.push(`❌ ${fullPath}: ${err.message}`);
      }
    }
  }
}

// ─── Resources ─────────────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  const resources: any[] = [];
  
  if (fs.existsSync(alpDir)) {
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (fullPath.endsWith('.alp')) {
          resources.push({
            uri: `file://${fullPath}`,
            name: path.relative(cwd, fullPath),
            mimeType: 'text/plain'
          });
        }
      }
    };
    walk(alpDir);
  }
  
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri.startsWith('file://')) {
    const filePath = uri.substring(7);
    if (fs.existsSync(filePath)) {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: fs.readFileSync(filePath, 'utf8')
        }]
      };
    }
  }
  throw new Error(`Resource not found: ${uri}`);
});

// ─── Start Server ─────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ALP MCP Server running on stdio');
}

main().catch(console.error);
