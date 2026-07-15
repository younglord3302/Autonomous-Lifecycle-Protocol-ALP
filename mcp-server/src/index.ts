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
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AlpParser, AlpObject, AlpGraph } from '@alp/parser';
import * as fs from 'fs';
import * as path from 'path';

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

// ─── MCP Server ───────────────────────────────────────────────────────────
const server = new Server(
  { name: 'alp-mcp-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

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

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

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

// ─── Start Server ─────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ALP MCP Server running on stdio');
}

main().catch(console.error);
