# ALP MCP Server

The official Model Context Protocol (MCP) server for the Autonomous Lifecycle Protocol.

This server enables modern AI IDEs (Claude Desktop, Cursor, Windsurf, etc.) to securely connect to your local ALP workspace and interact with your `.alp` graph via standardized tools.

## Installation

```bash
cd mcp-server
npm install
npm run build
npm start
```

## Available Tools

Once connected via MCP, the server exposes the following tools to the LLM agent:

- **`alp_get_graph`**: Get the full dependency graph of the ALP workspace as a sorted execution order.
- **`alp_get_status`**: Get the current project status, including task counts by state (`[x]`, `[~]`, `[ ]`, `[!]`, `[?]`).
- **`alp_read_object`**: Read a specific ALP object by its ID and return all its properties.
- **`alp_list_objects`**: List all objects, optionally filtered by type (e.g. `task`, `agent`, `memory`).
- **`alp_validate`**: Validate the ALP workspace and return any syntax or schema errors.
- **`alp_update_status`**: Update the status of a task (supports the `[?]` review marker for HITL handoffs).
- **`alp_get_impact`**: Get all downstream nodes affected by a change to a given node.
- **`alp_search`**: Fuzzy search across all object IDs and descriptions.

In addition, the server exposes the workspace `.alp` files as MCP **resources** (`file://` URIs) so a client can read raw object files directly.

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alp": {
      "command": "node",
      "args": [
        "/absolute/path/to/alp-monorepo/mcp-server/dist/index.js"
      ]
    }
  }
}
```
