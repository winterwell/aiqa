/**
 * Elasticsearch index/alias/mapping init: create indices, set mappings, ensure aliases.
 * Depends on db_es for client and index names. Call createIndices() after initClient().
 */

import { getClient, SPAN_INDEX, SPAN_INDEX_ALIAS, DATASET_EXAMPLES_INDEX, DATASET_EXAMPLES_INDEX_ALIAS } from './db_es.js';
import { loadSchema, jsonSchemaToEsMapping, getTypeDefinition } from '../common/utils/schema-loader.js';

function isNotFoundError(error: any): boolean {
  return error.meta?.statusCode === 404;
}

/** Recursively generate Elasticsearch mappings from JSON Schema properties */
function generateEsMappingsFromSchema(properties: Record<string, any>): Record<string, any> {
  const mappings: Record<string, any> = {};

  for (const [fieldName, prop] of Object.entries(properties)) {
    // Special handling: use 'flattened' type for attributes and annotations to avoid mapping explosion
    if ((fieldName === 'attributes' || fieldName === 'annotations') && prop.type === 'object') {
      mappings[fieldName] = { type: 'flattened' };
      continue;
    }

    // Special handling for time fields (start, end, duration)
    if ((fieldName === 'start' || fieldName === 'end' || fieldName === 'duration') &&
        prop.type === 'number') {
      mappings[fieldName] = { type: 'long' };
      continue;
    }

    const baseMapping = jsonSchemaToEsMapping(prop, fieldName);

    if (prop.type === 'object' && prop.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.properties);
    }
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.items.properties);
    }
    if (fieldName === 'events' && prop.type === 'array' && prop.items?.properties) {
      const eventProps = prop.items.properties;
      baseMapping.properties = {};
      if (eventProps.name) {
        baseMapping.properties.name = jsonSchemaToEsMapping(eventProps.name, 'name');
      }
      if (eventProps.time) {
        baseMapping.properties.timestamp = { type: 'long' };
      }
      if (eventProps.attributes) {
        baseMapping.properties.attributes = { type: 'flattened' };
      }
    }

    mappings[fieldName] = baseMapping;
  }
  return mappings;
}

/** Generate Elasticsearch mappings from Span schema. Exported for es_migration. */
export function generateSpanMappings(): any {
  const spanSchema = loadSchema('Span');
  const spanDef = getTypeDefinition(spanSchema, 'Span');
  if (!spanDef || !spanDef.properties) {
    throw new Error('Could not find Span properties in schema');
  }
  const mappings = generateEsMappingsFromSchema(spanDef.properties);
  mappings.unindexed_attributes = { type: 'object', enabled: false };
  return mappings;
}

function generateExampleMappings(): any {
  const exampleSchema = loadSchema('Example');
  const exampleDef = getTypeDefinition(exampleSchema, 'Example');
  if (!exampleDef || !exampleDef.properties) {
    throw new Error('Could not find Example properties in schema');
  }
  const mappings = generateEsMappingsFromSchema(exampleDef.properties);
  if (mappings.spans && mappings.spans.type === 'nested') {
    mappings.spans.properties = generateSpanMappings();
  }
  if (mappings.input) {
    mappings.input = { type: 'flattened' };
  }
  if (mappings.outputs) {
    mappings.outputs = { type: 'object', enabled: false };
  }
  if (mappings.metrics?.type === 'nested' && mappings.metrics.properties?.parameters) {
    mappings.metrics.properties.parameters = { type: 'object', enabled: false };
  }
  return mappings;
}

/**
 * Create index with mappings. If index already exists, update the mapping with any new fields.
 */
async function createIndex(indexName: string, mappings: any): Promise<void> {
  const client = getClient();
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    try {
      await client.indices.putMapping({ index: indexName, properties: mappings });
    } catch (error: any) {
      console.warn(`Could not update mapping for ${indexName}:`, error.message);
    }
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
        dynamic: false,
      },
    },
  });
}

async function getOtherIndicesWithAlias(alias: string, excludeIndex: string): Promise<string[]> {
  const client = getClient();
  try {
    const aliasIndices = await client.indices.getAlias({ name: alias });
    if (aliasIndices && typeof aliasIndices === 'object' && !Array.isArray(aliasIndices)) {
      return Object.keys(aliasIndices).filter(i => i !== excludeIndex);
    }
  } catch (error: any) {
    if (!isNotFoundError(error)) throw error;
  }
  return [];
}

/**
 * Create alias pointing to index if it doesn't exist.
 * If alias does exist - confirm it points to index (or throw an error)
 * @param index 
 * @param alias 
 * @returns 
 */
async function ensureAlias(index: string, alias: string): Promise<void> {
  if (index === alias) return;
  const client = getClient();
  const aliasNameIsIndex = await client.indices.exists({ index: alias });
  if (aliasNameIsIndex) {
    console.log(`Alias name [${alias}] is already an index or data stream; using it as-is.`);
    return;
  }
  const indexExists = await client.indices.exists({ index });
  if (!indexExists) {
    throw new Error(`Index ${index} does not exist. Create it before setting up aliases.`);
  }
  try {
    const aliasExists = await client.indices.existsAlias({ name: alias, index });
    if (aliasExists) return;
  } catch (error: any) {
    if (!isNotFoundError(error)) throw error;
  }
  const indicesWithAlias = await getOtherIndicesWithAlias(alias, index);
  const actions: any[] = [];
  if (indicesWithAlias.length > 0) {
    actions.push(...indicesWithAlias.map(i => ({ remove: { index: i, alias } })));
  }
  actions.push({ add: { index, alias } });
  await client.indices.updateAliases({ body: { actions } });
}


async function applyMigrations(): Promise<void> {
  // database freshly made - no migrations needed yet
}

/**
 * Create Elasticsearch indices with mappings and ensure aliases. Safe to call multiple times.
 * Call after initClient() during application startup.
 */
export async function createIndices(): Promise<void> {
  const spanMappings = generateSpanMappings();
  const exampleMappings = generateExampleMappings();
  await createIndex(SPAN_INDEX, spanMappings);
  await createIndex(DATASET_EXAMPLES_INDEX, exampleMappings);
  await ensureAlias(SPAN_INDEX, SPAN_INDEX_ALIAS);
  await ensureAlias(DATASET_EXAMPLES_INDEX, DATASET_EXAMPLES_INDEX_ALIAS);
  await applyMigrations();
}
