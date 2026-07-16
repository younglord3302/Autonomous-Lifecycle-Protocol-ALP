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
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
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
  { capabilities: { tools: {}, resources: {} } }
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
    {
      name: 'alp_update_status',
      description: 'Update the status of a specific task in the ALP workspace',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status (e.g. [ ], [~], [x], [!])' },
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
      // Very basic implementation: search files for id: X and change status above/below it
      const targetId = args?.id as string;
      const newStatus = args?.status as string;
      const alpDir = path.join(cwd, '.alp');
      let updated = false;
      const walk = (dir: string) => {
        if (updated) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (updated) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else if (fullPath.endsWith('.alp')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(`id: ${targetId}`)) {
              // naive replace of status
              content = content.replace(/(id:\s*.*?\n\s*status:\s*).*?(\n)/, `$1${newStatus}$2`);
              fs.writeFileSync(fullPath, content, 'utf8');
              updated = true;
            }
          }
        }
      };
      if (fs.existsSync(alpDir)) walk(alpDir);
      
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
