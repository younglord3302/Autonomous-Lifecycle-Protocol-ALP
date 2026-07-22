# Model Context Protocol (MCP) Server

ALP natively supports Anthropic's **Model Context Protocol**, allowing modern AI IDEs (like Claude Desktop, Cursor, and Windsurf) to securely query your `.alp` workspace and understand your architecture in real time.

## Installation

The MCP server is provided via the `@alp/mcp-server` package.

```bash
npm install -g @alp/mcp-server
```

## Available Tools

Once connected, your IDE gains access to the following tools:

### Core Tools

| Tool | Description |
| :--- | :--- |
| `alp_list_objects` | List all objects, optionally filtered by type (e.g., `task`, `agent`, `memory`) |
| `alp_read_object` | Read a specific ALP object by its ID to get detailed instructions, rules, or memory |
| `alp_get_graph` | Get the full dependency graph of the ALP workspace as a sorted execution order |
| `alp_get_status` | Get the current project status (task counts by state: `[x]`, `[~]`, `[ ]`, `[!]`, `[?]`) |
| `alp_validate` | Validate the ALP workspace to ensure the agent hasn't introduced syntax errors |
| `alp_update_status` | Update the status of a task (supports the `[?]` review marker for HITL handoffs) |
| `alp_get_impact` | Get all downstream nodes affected by a change to a given node |
| `alp_search` | Fuzzy search across all object IDs and descriptions |

### Advanced Tools — *v16.1.0*

| Tool | Description |
| :--- | :--- |
| `alp_check_policy` | Evaluate policy decisions — check if a file path or command is permitted by workspace `@policy` rules |
| `alp_visualize` | Generate a Mermaid DAG diagram of the project dependency graph for embedding in docs or chat |
| `alp_search_registry` | Search ALP objects by type, status, or keyword across the entire workspace |
| `alp_get_timelines` | Retrieve `@timeline` scheduling objects and their cron/at triggers |

In addition, the server exposes the workspace `.alp` files as MCP **resources** (`file://` URIs) so a client can read raw object files directly.

## Usage with Claude Desktop

To add ALP to Claude Desktop, edit your `claude_desktop_config.json` and add the server:

```json
{
  "mcpServers": {
    "alp": {
      "command": "alp-mcp",
      "args": []
    }
  }
}
```

## Usage with Cursor

Add to your `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "alp": {
      "command": "alp-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

## Usage with Windsurf

Add to your Windsurf MCP configuration (`~/.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "alp": {
      "command": "alp-mcp",
      "args": []
    }
  }
}
```

Now, your AI coding assistant can natively read your project's architecture, enforce policies, visualize dependencies, and query task states before writing a single line of code!
