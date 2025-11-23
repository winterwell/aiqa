import { Client } from '@elastic/elasticsearch';
import { Span } from './types/index.js';
import SearchQuery from './SearchQuery.js';
import { loadSchema, jsonSchemaToEsMapping, getTypeDefinition } from './utils/schema-loader.js';

let client: Client | null = null;
const SPAN_INDEX = 'traces';
const DATASET_SPANS_INDEX = 'dataset_spans';

export function initClient(elasticsearchUrl: string = 'http://localhost:9200'): void {
  client = new Client({
    node: elasticsearchUrl,
    requestTimeout: 10000,
  });
}

export function getClient(): Client {
  if (!client) {
    throw new Error('Elasticsearch client not initialized. Call initClient() first.');
  }
  return client;
}

// Recursively generate Elasticsearch mappings from JSON Schema properties
function generateEsMappingsFromSchema(properties: Record<string, any>): Record<string, any> {
  const mappings: Record<string, any> = {};
  
  for (const [fieldName, prop] of Object.entries(properties)) {
    // Special handling: use 'flattened' type for all 'attributes' fields to avoid mapping explosion
    if (fieldName === 'attributes' && prop.type === 'object') {
      mappings[fieldName] = { type: 'flattened' };
      continue;
    }
    
    const baseMapping = jsonSchemaToEsMapping(prop, fieldName);
    
    // If it's an object type, recursively process nested properties
    if (prop.type === 'object' && prop.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.properties);
    }
    
    // If it's an array with object items, process the item properties
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.items.properties);
    }
    
    // Special handling for events array (nested type with specific structure)
    // Events have 'time' property (HrTime) which maps to 'timestamp' in ES
    if (fieldName === 'events' && prop.type === 'array' && prop.items?.properties) {
      const eventProps = prop.items.properties;
      baseMapping.properties = {};
      if (eventProps.name) {
        baseMapping.properties.name = jsonSchemaToEsMapping(eventProps.name, 'name');
      }
      // Map 'time' (HrTime) to 'timestamp' (date) in Elasticsearch
      if (eventProps.time) {
        baseMapping.properties.timestamp = { type: 'date' };
      }
      // Use flattened type for event attributes
      if (eventProps.attributes) {
        baseMapping.properties.attributes = { type: 'flattened' };
      }
    }
    
    mappings[fieldName] = baseMapping;
  }
  
  return mappings;
}

// Generate Elasticsearch mappings from Span schema
function generateSpanMappings(): any {
  const spanSchema = loadSchema('Span');
  const spanDef = getTypeDefinition(spanSchema, 'Span');
  
  if (!spanDef || !spanDef.properties) {
    throw new Error('Could not find Span properties in schema');
  }
  
  // Generate all mappings from schema (including nested objects)
  return generateEsMappingsFromSchema(spanDef.properties);
}

// Generic function to create an Elasticsearch index
async function createIndex(indexName: string, mappings: any): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    return;
  }

  await client.indices.create({
    index: indexName,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'mapping.total_fields.limit': 1000,
        'mapping.depth.limit': 20,
      },
      mappings: {
        properties: mappings,
        dynamic: false
      }
    }
  });
}

// Generic bulk insert function
async function bulkInsert<T>(indexName: string, documents: T[]): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (documents.length === 0) return;

  const body = documents.flatMap(doc => [
    { index: { _index: indexName } },
    doc
  ]);

  await client.bulk({ body });
}

// Generic search function
async function searchEntities<T>(
  indexName: string,
  searchQuery?: SearchQuery | string | null,
  filters?: Record<string, string>,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: T[]; total: number }> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const esQuery: any = {
    bool: {
      must: [searchQueryToEsQuery(searchQuery)]
    }
  };

  // Add filters
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        esQuery.bool.must.push({ term: { [key]: value } });
      }
    }
  }

  const result = await client.search<T>({
    index: indexName,
    query: esQuery,
    size: limit,
    from: offset,
    sort: [{ '@timestamp': { order: 'desc' } }]
  });

  const hits = (result.hits.hits || []).map((hit: any) => hit._source!);
  const total = result.hits.total as number | { value: number };

  return { hits, total: typeof total === 'number' ? total : total.value };
}

export async function createSchema(): Promise<void> {
  const mappings = generateSpanMappings();
  await createIndex(SPAN_INDEX, mappings);
  await createIndex(DATASET_SPANS_INDEX, mappings);
}

export async function bulkInsertSpans(spans: Span[]): Promise<void> {
  return bulkInsert<Span>(SPAN_INDEX, spans);
}

export async function bulkInsertInputs(inputs: Span[]): Promise<void> {
  return bulkInsert<Span>(DATASET_SPANS_INDEX, inputs);
}

// Convert SearchQuery to Elasticsearch query
function searchQueryToEsQuery(sq: SearchQuery | string | null | undefined): any {
  if (!sq) {
    return { match_all: {} };
  }

  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;
  if (!searchQuery.tree || searchQuery.tree.length === 0) {
    return { match_all: {} };
  }

  return buildEsQuery(searchQuery.tree);
}

function buildEsQuery(tree: any[]): any {
  if (typeof tree === 'string') {
    return { match: { _all: tree } };
  }

  if (tree.length === 1) {
    const item = tree[0];
    if (typeof item === 'string') {
      return { match: { _all: item } };
    }
    if (typeof item === 'object' && !Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length === 1) {
        const key = keys[0];
        const value = item[key];
        return { term: { [key]: value } };
      }
    }
    return buildEsQuery(Array.isArray(item) ? item : [item]);
  }

  const op = tree[0];
  const bits = tree.slice(1);

  const queries = bits.map((bit: any) => {
    if (typeof bit === 'object' && !Array.isArray(bit)) {
      const keys = Object.keys(bit);
      if (keys.length === 1) {
        const key = keys[0];
        const value = bit[key];
        return { term: { [key]: value } };
      }
    }
    return buildEsQuery(Array.isArray(bit) ? bit : [bit]);
  });

  if (op === 'OR') {
    return { bool: { should: queries, minimum_should_match: 1 } };
  } else {
    return { bool: { must: queries } };
  }
}

export async function searchSpans(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: Span[]; total: number }> {
  return searchEntities<Span>(
    SPAN_INDEX,
    searchQuery,
    organisationId ? { organisation_id: organisationId } : undefined,
    limit,
    offset
  );
}

export async function searchInputs(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  datasetId?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: Span[]; total: number }> {
  const filters: Record<string, string> = {};
  if (organisationId) {
    filters.organisation_id = organisationId;
  }
  if (datasetId) {
    filters.dataset_id = datasetId;
  }
  return searchEntities<Span>(
    DATASET_SPANS_INDEX,
    searchQuery,
    Object.keys(filters).length > 0 ? filters : undefined,
    limit,
    offset
  );
}

export async function closeClient(): Promise<void> {
  if (client) {
    // Elasticsearch client doesn't have a close method, but we can reset it
    client = null;
  }
}

