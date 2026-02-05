# AIQA MCP Server

MCP (Model Context Protocol) server for AIQA, providing tools for Cursor and Claude Code users to interact with server-aiqa.

## Features

- **Create** datasets, examples, and experiments
- **Query** traces, experiments, datasets, and examples with filters and limits
- **Get** trace dashboard statistics

All tools enforce filters and limits to reduce token usage (e.g., only get examples for a specific dataset, only most recent 20 root spans).

## Quick Start

### For Users (Connecting to Hosted Service)

The MCP server is hosted by AIQA at **https://mcp-aiqa.winterwell.com**. Users configure Cursor or Claude Code to connect to it:

1. Get your API key from the AIQA webapp (API Keys section)
2. Configure Cursor/Claude Code to connect to `https://mcp-aiqa.winterwell.com/sse`
3. Provide your API key in the Authorization header

**Example Cursor configuration:**
```json
{
  "mcpServers": {
    "aiqa": {
      "url": "https://mcp-aiqa.winterwell.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed configuration instructions.

### For Developers (Running Locally)

```bash
cd aiqa/mcp
pnpm install
pnpm run build
```

Set environment variables:
```bash
export AIQA_API_BASE_URL=http://localhost:4318
export MCP_PORT=4319
```

Run:
```bash
pnpm start
```

The server runs as an HTTP service on port 4319 (configurable via MCP_PORT).

## Available Tools

### Creation Tools

- `create_dataset` - Create a new dataset
- `create_example` - Create a new example (eval) in a dataset
- `create_experiment` - Create a new experiment

### Query Tools

- `query_datasets` - Query datasets (supports organisation filter, search query, pagination)
- `query_examples` - Query examples (recommended: filter by dataset to reduce token usage)
- `query_experiments` - Query experiments (supports dataset/organisation filters)
- `query_traces` - Query traces/spans (recommended: use `isRoot=true` and `limit` to reduce token usage)

### Statistics Tools

- `get_trace_stats` - Get trace dashboard statistics (duration, tokens, cost, feedback)

## Example Usage

### Create a Dataset

```json
{
  "tool": "create_dataset",
  "arguments": {
    "organisation": "org-uuid",
    "name": "My Dataset",
    "description": "Dataset for testing"
  }
}
```

### Query Traces (Root Spans Only)

```json
{
  "tool": "query_traces",
  "arguments": {
    "organisation": "org-uuid",
    "isRoot": true,
    "limit": 20,
    "query": "name:llm"
  }
}
```

### Get Trace Statistics

```json
{
  "tool": "get_trace_stats",
  "arguments": {
    "organisation": "org-uuid",
    "limit": 20
  }
}
```

## Development

### Build

```bash
pnpm run build
```

### Tests

```bash
# Unit tests
pnpm run test:unit

# Integration tests (requires running server-aiqa)
export AIQA_API_BASE_URL=http://localhost:4318
export AIQA_API_KEY=your-api-key
pnpm run test:integration
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

## Architecture

The MCP server:
1. Receives tool calls via stdio (MCP protocol)
2. Validates and processes requests
3. Makes HTTP requests to server-aiqa API using the configured API key
4. Returns results formatted for MCP clients

## Token Usage Optimization

To minimize token usage:
- Use `limit` parameters (defaults are conservative)
- Filter queries by `dataset` when querying examples
- Use `isRoot=true` when querying traces
- Use `fields` and `exclude` parameters to limit returned data
- Query only what you need

## License

Same as the main AIQA project.
