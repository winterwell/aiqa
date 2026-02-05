#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AiqaApiClient } from './client.js';

const SERVER_NAME = 'aiqa-mcp-server';
const SERVER_VERSION = '1.0.0';

// Get configuration from environment variables
const API_BASE_URL = process.env.AIQA_API_BASE_URL || 'http://localhost:4318';
const MCP_PORT = parseInt(process.env.MCP_PORT || '4319', 10);

// Function to set up tool handlers for a server instance
function setupToolHandlers(server: Server, apiKey: string) {
  const client = new AiqaApiClient(API_BASE_URL, apiKey);

  // Tool: create_dataset
  server.setRequestHandler('tools/list' as any, async () => ({
  tools: [
    {
      name: 'create_dataset',
      description: 'Create a new dataset. Datasets are collections of examples used for evaluation.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID)',
          },
          name: {
            type: 'string',
            description: 'Dataset name (required)',
          },
          description: {
            type: 'string',
            description: 'Optional description',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags',
          },
        },
        required: ['organisation', 'name'],
      },
    },
    {
      name: 'create_example',
      description: 'Create a new example (eval) in a dataset. Examples represent test cases for evaluation.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - required',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          name: {
            type: 'string',
            description: 'Optional example name',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags',
          },
          input: {
            description: 'Input data for the example (alternative to spans)',
          },
          spans: {
            type: 'array',
            description: 'Spans from a trace to use as input (alternative to input)',
          },
          trace: {
            type: 'string',
            description: 'Trace ID if creating from a trace',
          },
          outputs: {
            type: 'object',
            properties: {
              good: { description: 'Example of good output' },
              bad: { description: 'Example of bad output' },
            },
          },
        },
        required: ['dataset', 'organisation'],
      },
    },
    {
      name: 'create_experiment',
      description: 'Create a new experiment. Experiments run datasets of examples and score the outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - required',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          name: {
            type: 'string',
            description: 'Optional experiment name',
          },
          batch: {
            type: 'string',
            description: 'Optional batch ID to group experiments together',
          },
          parameters: {
            type: 'object',
            description: 'Optional parameters (e.g. model, temperature)',
          },
        },
        required: ['dataset', 'organisation'],
      },
    },
    {
      name: 'query_datasets',
      description: 'Query datasets with optional filters. Returns list of datasets matching criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - optional, filters by organisation',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 100)',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_examples',
      description: 'Query examples with optional filters. Returns list of examples matching criteria. Use dataset filter to reduce token usage.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - recommended to filter by dataset to reduce token usage',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max recommended: 100)',
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_experiments',
      description: 'Query experiments with optional filters. Returns list of experiments matching criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - optional, filters by dataset',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - optional, filters by organisation',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 100)',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_traces',
      description: 'Query traces (spans) with optional filters. Returns list of spans matching criteria. Use isRoot=true and limit to reduce token usage.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style, e.g. "name:llm" or "trace:abc-123")',
          },
          isRoot: {
            type: 'boolean',
            description: 'If true, only return root spans (recommended to reduce token usage, default: true)',
            default: true,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max recommended: 100)',
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
          fields: {
            type: 'string',
            description: 'Comma-separated fields to include, or "*" for all (default excludes attributes)',
          },
          exclude: {
            type: 'string',
            description: 'Comma-separated fields to exclude (e.g. "attributes.input,attributes.output")',
          },
        },
        required: ['organisation'],
      },
    },
    {
      name: 'get_trace_stats',
      description: 'Get trace dashboard statistics including duration, tokens, cost, and feedback metrics.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          query: {
            type: 'string',
            description: 'Optional search query to filter traces (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of traces to analyze (default: 20)',
            default: 20,
          },
        },
        required: ['organisation'],
      },
    },
  ],
}));

  // Handle tool calls - use the client created for this connection
  server.setRequestHandler('tools/call' as any, async (request) => {
    const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_dataset': {
        const dataset = await client.createDataset({
          organisation: args.organisation as string,
          name: args.name as string,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dataset, null, 2),
            },
          ],
        };
      }

      case 'create_example': {
        const example = await client.createExample({
          dataset: args.dataset as string,
          organisation: args.organisation as string,
          name: args.name as string | undefined,
          tags: args.tags as string[] | undefined,
          input: args.input,
          spans: args.spans as any[] | undefined,
          trace: args.trace as string | undefined,
          outputs: args.outputs as { good: any; bad: any } | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(example, null, 2),
            },
          ],
        };
      }

      case 'create_experiment': {
        const experiment = await client.createExperiment({
          dataset: args.dataset as string,
          organisation: args.organisation as string,
          name: args.name as string | undefined,
          batch: args.batch as string | undefined,
          parameters: args.parameters as Record<string, any> | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(experiment, null, 2),
            },
          ],
        };
      }

      case 'query_datasets': {
        const datasets = await client.listDatasets(
          args.organisation as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(datasets, null, 2),
            },
          ],
        };
      }

      case 'query_examples': {
        const examples = await client.listExamples(
          args.dataset as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(examples, null, 2),
            },
          ],
        };
      }

      case 'query_experiments': {
        const experiments = await client.listExperiments(
          args.dataset as string | undefined,
          args.organisation as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(experiments, null, 2),
            },
          ],
        };
      }

      case 'query_traces': {
        const traces = await client.queryTraces(
          args.organisation as string,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined,
          args.fields as string | undefined,
          args.exclude as string | undefined,
          args.isRoot !== undefined ? (args.isRoot as boolean) : true
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(traces, null, 2),
            },
          ],
        };
      }

      case 'get_trace_stats': {
        const stats = await client.getTraceStats(
          args.organisation as string,
          args.query as string | undefined,
          args.limit as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
  });
}

// Create Fastify server for HTTP/SSE transport
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register CORS
fastify.register(cors, {
  origin: true, // Allow all origins
  credentials: true,
});

// Store API keys per connection (in production, use a proper session store)
const connectionApiKeys = new Map<string, string>();

// MCP SSE endpoint - handles server-to-client messages
fastify.get('/sse', async (request, reply) => {
  // Extract API key from Authorization header or query parameter
  const authHeader = request.headers.authorization;
  let apiKey: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7).trim();
  } else if (authHeader?.startsWith('ApiKey ')) {
    apiKey = authHeader.substring(7).trim();
  } else {
    // Fallback to query parameter (less secure, but some clients may need it)
    apiKey = (request.query as any).apiKey;
  }

  if (!apiKey) {
    reply.code(401).send({ error: 'API key required. Provide via Authorization header (Bearer <key> or ApiKey <key>) or ?apiKey= query parameter' });
    return;
  }

  // Generate connection ID
  const connectionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  connectionApiKeys.set(connectionId, apiKey);

  // Set up SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Create transport and store API key on it
  const transport = new SSEServerTransport('/sse', reply.raw);
  (transport as any).apiKey = apiKey;
  
  // Create a new server instance for this connection (MCP servers are typically per-connection)
  const connectionServer = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers on this connection's server
  setupToolHandlers(connectionServer, apiKey);
  
  await connectionServer.connect(transport);
  
  // Clean up on connection close
  reply.raw.on('close', () => {
    connectionApiKeys.delete(connectionId);
  });
});

// MCP message endpoint - handles client-to-server messages
fastify.post('/message', async (request, reply) => {
  // For POST messages, API key should be in Authorization header
  const authHeader = request.headers.authorization;
  let apiKey: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7).trim();
  } else if (authHeader?.startsWith('ApiKey ')) {
    apiKey = authHeader.substring(7).trim();
  }

  if (!apiKey) {
    reply.code(401).send({ error: 'API key required in Authorization header' });
    return;
  }

  // Find the transport for this API key (in a real implementation, you'd use session management)
  // For now, we'll handle this in the tool handler by creating a new client per request
  reply.send({ received: true });
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', service: SERVER_NAME, version: SERVER_VERSION };
});

// Start server
async function main() {
  try {
    await fastify.listen({ port: MCP_PORT, host: '0.0.0.0' });
    console.log(`${SERVER_NAME} v${SERVER_VERSION} listening on port ${MCP_PORT}`);
    console.log(`MCP SSE endpoint: http://localhost:${MCP_PORT}/sse`);
    console.log(`MCP message endpoint: http://localhost:${MCP_PORT}/message`);
    console.log(`Health check: http://localhost:${MCP_PORT}/health`);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
