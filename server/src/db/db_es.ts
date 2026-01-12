/**
 * Elasticsearch operations for storing and querying OpenTelemetry spans and examples.
 * 
 * Lifecycle: Call initClient() before any operations, closeClient() during shutdown.
 * All functions throw if client not initialized. Uses two indices: 'traces' for spans, 'DATASET_EXAMPLES' for examples.
 */

import { Client } from '@elastic/elasticsearch';
import Span from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { loadSchema, jsonSchemaToEsMapping, getTypeDefinition } from '../common/utils/schema-loader.js';
import { searchEntities as searchEntitiesEs } from './es_query.js';
import Example from '../common/types/Example.js';

let client: Client | null = null;
const SPAN_INDEX = process.env.SPANS_INDEX || 'aiqa_spans';
const SPAN_INDEX_ALIAS = process.env.SPANS_INDEX_ALIAS || 'aiqa_spans_alias';
const DATASET_EXAMPLES_INDEX = process.env.DATASET_EXAMPLES_INDEX || 'aiqa_dataset_examples';
const DATASET_EXAMPLES_INDEX_ALIAS = process.env.DATASET_EXAMPLES_INDEX_ALIAS || 'aiqa_dataset_examples_alias';

/**
 * Initialize Elasticsearch client. Must be called before any operations.
 */
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

/**
 * Check if Elasticsearch is available by pinging the cluster.
 * Returns true if available, false otherwise.
 */
export async function checkElasticsearchAvailable(): Promise<boolean> {
  if (!client) {
    return false;
  }
  try {
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**  Recursively generate Elasticsearch mappings from JSON Schema properties */
function generateEsMappingsFromSchema(properties: Record<string, any>): Record<string, any> {
  const mappings: Record<string, any> = {};
  
  for (const [fieldName, prop] of Object.entries(properties)) {
    // Special handling: use 'flattened' type for all 'attributes' fields to avoid mapping explosion
    if (fieldName === 'attributes' && prop.type === 'object') {
      mappings[fieldName] = { type: 'flattened' };
      continue;
    }
    
    // Special handling for HrTime fields (startTime, endTime, duration)
    // These are arrays of [seconds, nanoseconds] that we'll convert to milliseconds (long)
    if ((fieldName === 'startTime' || fieldName === 'endTime' || fieldName === 'duration') &&
        prop.type === 'array' && prop.items?.type === 'integer' && 
        prop.minItems === 2 && prop.maxItems === 2) {
      mappings[fieldName] = { type: 'long' };
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
  const mappings = generateEsMappingsFromSchema(spanDef.properties);
  // "hidden" backend support for large attributes that get truncated
  mappings.unindexed_attributes = {
    type: 'object',
    enabled: false  // Disable indexing to allow storing large values without truncation
  };
  return mappings;
}

// Generate Elasticsearch mappings for Example schema
// Examples have a spans field that should use flattened and time types like Span
function generateExampleMappings(): any {
  const exampleSchema = loadSchema('Example');
  const exampleDef = getTypeDefinition(exampleSchema, 'Example');
  
  if (!exampleDef || !exampleDef.properties) {
    throw new Error('Could not find Example properties in schema');
  }
  
  // Generate base mappings from schema
  const mappings = generateEsMappingsFromSchema(exampleDef.properties);
  
  // Reuse span mappings for the spans array field - spans are nested Span objects
  if (mappings.spans && mappings.spans.type === 'nested') {
    const spanMappings = generateSpanMappings();
    mappings.spans.properties = spanMappings;
  }
  
  // Special handling for inputs field - store as-is, not indexed
  if (mappings.inputs) {
    mappings.inputs = { type: 'object', enabled: false };
  }  
  return mappings;
}

// Generic function to create an Elasticsearch index
async function createIndex(indexName: string, mappings: any): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    // Index exists - try to update mapping with any new fields
    // Elasticsearch allows adding new fields but not changing existing ones
    try {
      await client.indices.putMapping({
        index: indexName,
        properties: mappings
      });
    } catch (error: any) {
      // Ignore mapping update errors (e.g., if fields already exist or can't be updated)
      // This is safe - existing fields won't be changed, new fields will be added
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
        dynamic: false
      }
    }
  });
}

// Convert HrTime tuple [seconds, nanoseconds] to milliseconds
function hrTimeToMillis(hrTime: [number, number] | undefined): number | undefined {
  if (!hrTime || !Array.isArray(hrTime) || hrTime.length !== 2) {
    return undefined;
  }
  return hrTime[0] * 1000 + Math.floor(hrTime[1] / 1000000);
}

// Elasticsearch flattened fields have a max value size of 32,766 bytes
// We truncate to 30KB to leave some margin for encoding overhead
const MAX_ATTRIBUTE_VALUE_SIZE = 30 * 1024; // 30KB

/**
 * Truncate a string to fit within a byte limit, preserving UTF-8 encoding.
 */
function truncateStringToByteLength(str: string, maxBytes: number): string {
  const buffer = Buffer.from(str, 'utf8');
  if (buffer.length <= maxBytes) {
    return str;
  }
  // Truncate buffer and convert back, handling potential incomplete UTF-8 sequences
  const truncated = buffer.subarray(0, maxBytes);
  // Find the last valid UTF-8 character boundary
  let end = truncated.length;
  while (end > 0 && (truncated[end] & 0xc0) === 0x80) {
    end--;
  }
  return truncated.subarray(0, end).toString('utf8');
}

/**
 * Truncate large string values in attributes to prevent Elasticsearch flattened field errors.
 * Values exceeding MAX_ATTRIBUTE_VALUE_SIZE are truncated and a flag is added.
 * Returns both truncated attributes and big attributes (original values that were too large).
 */
function truncateLargeAttributeValues(attributes: any): { truncated: any; bigAttributes: any } {
  if (!attributes || typeof attributes !== 'object') {
    return { truncated: attributes, bigAttributes: {} };
  }

  const truncated: any = {};
  const bigAttributes: any = {};
  for (const [key, value] of Object.entries(attributes)) {
    try {
      const stringValue = typeof value !== 'string' ? JSON.stringify(value) : value;
      const byteSize = Buffer.byteLength(stringValue, 'utf8');
      if (byteSize > MAX_ATTRIBUTE_VALUE_SIZE) {
        const safeSize = MAX_ATTRIBUTE_VALUE_SIZE - 200; // Leave room for metadata keys
        truncated[key] = truncateStringToByteLength(stringValue, safeSize);
        truncated[`${key}_truncated`] = true;
        truncated[`${key}_original_size`] = byteSize;
        bigAttributes[key] = value;
      } else {
        truncated[key] = value;
      }
    } catch (error: any) {
      console.error(`Error truncating attribute value for ${key}:`, error.message);
      truncated[key] = value;
    }
  }
  return { truncated, bigAttributes };
}

/**
 * Check if an object has any keys.
 */
function hasKeys(obj: any): boolean {
  return obj && typeof obj === 'object' && Object.keys(obj).length > 0;
}

/**
 * Process attributes field: truncate and collect big attributes.
 * Returns the truncated attributes and big attributes (if any).
 */
function processAttributes(attributes: any): { truncated: any; bigAttributes: any } {
  if (!attributes) return { truncated: attributes, bigAttributes: {} };
  const { truncated, bigAttributes } = truncateLargeAttributeValues(attributes);
  return { truncated, bigAttributes };
}

/**
 * Process an array of items that may have attributes, collecting big attributes by index.
 * Returns transformed array and array of big attributes indexed by position.
 */
function processArrayWithAttributes<T>(
  array: T[] | undefined,
  transformItem: (item: T, index: number) => { transformed: any; bigAttributes?: any }
): { transformed: any[]; bigAttributes: any[] } {
  if (!Array.isArray(array)) return { transformed: array || [], bigAttributes: [] };
  
  const transformed: any[] = [];
  const bigAttributes: any[] = [];
  
  array.forEach((item, index) => {
    const { transformed: itemTransformed, bigAttributes: itemBigAttrs } = transformItem(item, index);
    transformed.push(itemTransformed);
    if (hasKeys(itemBigAttrs)) {
      bigAttributes[index] = itemBigAttrs;
    }
  });
  
  return { transformed, bigAttributes };
}

/**
 * Convert HrTime tuple [seconds, nanoseconds] to milliseconds for multiple fields.
 */
function convertHrTimeFields(obj: any, fields: string[]): void {
  for (const field of fields) {
    if (Array.isArray(obj[field]) && obj[field].length === 2) {
      obj[field] = hrTimeToMillis(obj[field] as [number, number]);
    }
  }
}

// Transform span document for Elasticsearch (convert HrTime tuples to milliseconds)
function transformSpanForEs(doc: any): any {
  const transformed = { ...doc };
  const unindexedBigAttributes: any = {};
  
  // Convert HrTime fields to milliseconds
  convertHrTimeFields(transformed, ['startTime', 'endTime', 'duration']);
  
  // Process top-level attributes
  const { truncated: attrsTruncated, bigAttributes: attrsBig } = processAttributes(transformed.attributes);
  transformed.attributes = attrsTruncated;
  if (hasKeys(attrsBig)) {
    unindexedBigAttributes.attributes = attrsBig;
  }
  
  // Process events array
  const { transformed: eventsTransformed, bigAttributes: eventsBig } = processArrayWithAttributes(
    transformed.events,
    (event: any) => {
      const eventTransformed = { ...event };
      // Convert event.time to timestamp
      if (Array.isArray(event.time) && event.time.length === 2) {
        const { time, ...rest } = eventTransformed;
        eventTransformed.timestamp = hrTimeToMillis(time as [number, number]);
        delete eventTransformed.time;
      }
      // Process event attributes
      const { truncated: eventAttrsTruncated, bigAttributes: eventAttrsBig } = processAttributes(eventTransformed.attributes);
      eventTransformed.attributes = eventAttrsTruncated;
      return {
        transformed: eventTransformed,
        bigAttributes: eventAttrsBig
      };
    }
  );
  transformed.events = eventsTransformed;
  if (eventsBig.length > 0) {
    unindexedBigAttributes.events = eventsBig;
  }
  
  // Process resource attributes
  if (transformed.resource?.attributes) {
    const { truncated: resourceAttrsTruncated, bigAttributes: resourceAttrsBig } = processAttributes(transformed.resource.attributes);
    transformed.resource.attributes = resourceAttrsTruncated;
    if (hasKeys(resourceAttrsBig)) {
      unindexedBigAttributes.resource = { attributes: resourceAttrsBig };
    }
  }
  
  // Process links array
  const { transformed: linksTransformed, bigAttributes: linksBig } = processArrayWithAttributes(
    transformed.links,
    (link: any) => {
      const { truncated: linkAttrsTruncated, bigAttributes: linkAttrsBig } = processAttributes(link?.attributes);
      return {
        transformed: { ...link, attributes: linkAttrsTruncated },
        bigAttributes: hasKeys(linkAttrsBig) ? linkAttrsBig : undefined
      };
    }
  );
  transformed.links = linksTransformed;
  if (linksBig.length > 0) {
    unindexedBigAttributes.links = linksBig;
  }
  
  // Store unindexed big attributes if any were found
  if (hasKeys(unindexedBigAttributes)) {
    transformed.unindexed_attributes = unindexedBigAttributes;
  }
  
  return transformed;
}

// Transform example document for Elasticsearch (convert spans array with HrTime tuples)
function transformExampleForEs(doc: any): any {
  const transformed = { ...doc };
  
  // Transform spans array if present
  if (Array.isArray(transformed.spans)) {
    transformed.spans = transformed.spans.map((span: any) => transformSpanForEs(span));
  }
  
  // Process example-level attributes
  const { truncated: attrsTruncated, bigAttributes: attrsBig } = processAttributes(transformed.attributes);
  transformed.attributes = attrsTruncated;
  if (hasKeys(attrsBig)) {
    transformed.unindexed_attributes = { attributes: attrsBig };
  }
  
  return transformed;
}

// Generic bulk insert function
async function bulkInsert<T>(indexName: string, documents: T[], transformFn?: (doc: any) => any): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (documents.length === 0) return;

  const transform = transformFn || transformSpanForEs;

  const body = documents.flatMap(doc => {
    const transformed = transform(doc);
    const docId = (doc as any).spanId || (doc as any).id;
    const indexAction = docId 
      ? { index: { _index: indexName, _id: docId } }
      : { index: { _index: indexName } };
    return [indexAction, transformed];
  });

  const response = await client.bulk({ 
    body,
    refresh: 'wait_for' // Make documents immediately searchable
  });

  // Check for errors in bulk response
  if (response.errors) {
    const erroredDocuments: any[] = [];
    response.items.forEach((action: any, i: number) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        erroredDocuments.push({
          operation,
        //   document: documents[Math.floor(i / 2)],
          error: action[operation].error
        });
      }
    });
    if (erroredDocuments.length > 0) {
      throw new Error(`Bulk insert errors: ${JSON.stringify(erroredDocuments, null, 2).slice(0, 1000)}...`);
    }
  }
}

/**Generic search function wrapper. This is the function for getting entities from Elasticsearch. */
async function searchEntities<T>(
  indexName: string,
  searchQuery?: SearchQuery | string | null,
  filters?: Record<string, string>,
  limit: number = 100,
  offset: number = 0,
  _source_includes?: string[] | null,
  _source_excludes?: string[] | null
): Promise<{ hits: T[]; total: number }> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }
  return searchEntitiesEs<T>(client, indexName, searchQuery, filters, limit, offset, _source_includes, _source_excludes);
}

/**
 * Check if an error is a 404 (not found) error.
 */
function isNotFoundError(error: any): boolean {
  return error.meta?.statusCode === 404;
}

/**
 * Get indices that have a given alias, excluding the specified index.
 */
async function getOtherIndicesWithAlias(alias: string, excludeIndex: string): Promise<string[]> {
  if (!client) throw new Error('Elasticsearch client not initialized.');
  
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

// Also ensure index aliases exist and point to the correct indices
async function ensureAlias(index: string, alias: string): Promise<void> {
  if (index === alias) return; // skip if alias is just the index name
  if (!client) throw new Error('Elasticsearch client not initialized.');
  
  // Check if index exists first
  const indexExists = await client.indices.exists({ index });
  if (!indexExists) {
    throw new Error(`Index ${index} does not exist. Create it before setting up aliases.`);
  }
  
  // Check if alias already points to this index
  try {
    const aliasExists = await client.indices.existsAlias({ name: alias, index });
    if (aliasExists) return; // Alias already correctly configured
  } catch (error: any) {
    if (!isNotFoundError(error)) throw error;
  }
  
  // Get indices that currently have this alias (excluding our target index)
  const indicesWithAlias = await getOtherIndicesWithAlias(alias, index);
  
  // Build actions: remove alias from other indices, then add to target index
  const actions: any[] = [];
  if (indicesWithAlias.length > 0) {
    actions.push(...indicesWithAlias.map(i => ({ remove: { index: i, alias } })));
  }
  actions.push({ add: { index, alias } });
  
  // Update aliases atomically
  await client.indices.updateAliases({ body: { actions } });
}
  
/**
 * Apply migration to add unindexed_attributes field to an index if it doesn't exist.
 */
async function migrationAddUnindexedAttributesToIndex(indexName: string): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) return;

  try {
    const currentMapping = await client.indices.getMapping({ index: indexName });
    const mappingKey = Object.keys(currentMapping)[0];
    const properties = currentMapping[mappingKey]?.mappings?.properties;
    
    if (!properties?.unindexed_attributes) {
      const unindexedMapping: any = { type: 'object', enabled: false };
      await client.indices.putMapping({
        index: indexName,
        properties: { unindexed_attributes: unindexedMapping }
      });
      console.log(`Added unindexed_attributes field to ${indexName}`);
    }
  } catch (error: any) {
    console.warn(`Could not apply migration to ${indexName}:`, error.message);
  }
}

/**
 * Apply migration to ensure starred field is indexed in spans index.
 */
async function migrationEnsureStarredField(indexName: string): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) return;

  try {
    const currentMapping = await client.indices.getMapping({ index: indexName });
    const mappingKey = Object.keys(currentMapping)[0];
    const properties = currentMapping[mappingKey]?.mappings?.properties;
    
    // Check if starred field exists and is properly mapped
    if (!properties?.starred) {
      await client.indices.putMapping({
        index: indexName,
        properties: { starred: { type: 'boolean' } }
      });
      console.log(`Added starred field to ${indexName}`);
    }
  } catch (error: any) {
    console.warn(`Could not apply starred field migration to ${indexName}:`, error.message);
  }
}

/**
 * Apply migrations to Elasticsearch indices. Safe to call multiple times.
 * Updates mappings for existing indices.
 */
async function applyMigrations(): Promise<void> {
  await migrationAddUnindexedAttributesToIndex(SPAN_INDEX);
  await migrationAddUnindexedAttributesToIndex(DATASET_EXAMPLES_INDEX);
  await migrationEnsureStarredField(SPAN_INDEX);
}

/**
 * Create Elasticsearch indices with mappings. Safe to call multiple times (skips if index exists).
 * Call during application startup.
 */
export async function createIndices(): Promise<void> {
  const spanMappings = generateSpanMappings();
  const exampleMappings = generateExampleMappings();
  await createIndex(SPAN_INDEX, spanMappings);
  await createIndex(DATASET_EXAMPLES_INDEX, exampleMappings);
 
  await ensureAlias(SPAN_INDEX, SPAN_INDEX_ALIAS);
  await ensureAlias(DATASET_EXAMPLES_INDEX, DATASET_EXAMPLES_INDEX_ALIAS);
  
  // Apply migrations after indices are created/updated
  await applyMigrations();
}

/**
 * Bulk insert spans into 'traces' index. Spans should have organisation set.
 */
export async function bulkInsertSpans(spans: Span[]): Promise<void> {
  return bulkInsert<Span>(SPAN_INDEX_ALIAS, spans);
}


/**
 * Search spans in 'traces' index. Filters by organisationId if provided.
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 * @param _source_includes - Array of field names to include in _source, or undefined for all fields.
 * @param _source_excludes - Array of field names to exclude from _source, or undefined for no exclusions. You are strongly encouraged to exclude attributes and unindexed_attributes using this to avoid returning big data.
 */
export async function searchSpans(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  limit: number = 100,
  offset: number = 0,
  _source_includes?: string[] | null,
  _source_excludes?: string[] | null
): Promise<{ hits: Span[]; total: number }> {    
  return searchEntities<Span>(
    SPAN_INDEX_ALIAS,
    searchQuery,
    { organisation: organisationId },
    limit,
    offset,
    _source_includes,
    _source_excludes
  );
}

/**
 * Update a span by ID in ElasticSearch. Performs partial update (only updates provided fields).
 * @param spanId - The ID of the span to update (used as document _id in ElasticSearch, as set during bulk insert)
 * @param updates - Partial span object with fields to update
 * @param organisationId - Optional organisation ID to verify ownership
 * @returns The updated span, or null if not found
 */
export async function updateSpan(
  spanId: string,
  updates: Partial<Span>,
  organisationId?: string
): Promise<Span | null> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  try {
    // Get the current document to verify it exists and belongs to the organisation
    const getResponse = await client.get({
      index: SPAN_INDEX_ALIAS,
      id: spanId,
    });

    const currentSpan = getResponse._source as any;
    
    // Verify organisation if provided
    if (organisationId && currentSpan.organisation !== organisationId) {
      return null; // Span doesn't belong to this organisation
    }

    // Prepare update document - only include fields that are being updated
    const updateDoc: any = {};
    Object.keys(updates).forEach(key => {
      if (updates[key as keyof Span] !== undefined) {
        updateDoc[key] = updates[key as keyof Span];
      }
    });

    if (Object.keys(updateDoc).length === 0) {
      // No updates to apply, return current span
      return currentSpan as Span;
    }

    // Transform the update document if needed (for fields like startTime, endTime)
    // For starred, we can update directly
    const transformedUpdate = { ...updateDoc };
    
    // Update the document by its _id
    await client.update({
      index: SPAN_INDEX_ALIAS,
      id: spanId,
      body: {
        doc: transformedUpdate,
      },
      refresh: 'wait_for', // Make update immediately visible
    });

    // Fetch and return the updated document
    const updatedResponse = await client.get({
      index: SPAN_INDEX_ALIAS,
      id: spanId,
    });

    return updatedResponse._source as Span;
  } catch (error: any) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Bulk insert examples into 'DATASET_EXAMPLES' index. Examples should have organisation and dataset set.
 */
export async function bulkInsertExamples(examples: Example[]): Promise<void> {
  return bulkInsert<Example>(DATASET_EXAMPLES_INDEX_ALIAS, examples, transformExampleForEs);
}

/**
 * Search examples in 'DATASET_EXAMPLES' index. Filters by organisationId and/or datasetId if provided.
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function searchExamples(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  datasetId?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: Example[]; total: number }> {
  const filters: Record<string, string> = {};
  if (organisationId) filters.organisation = organisationId;
  if (datasetId) filters.dataset = datasetId;
  return searchEntities<Example>(
    DATASET_EXAMPLES_INDEX_ALIAS,
    searchQuery,
    hasKeys(filters) ? filters : undefined,
    limit,
    offset
  );
}

/**
 * Delete an index. Useful for testing.
 */
export async function deleteIndex(indexName: string): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    await client.indices.delete({ index: indexName });
  }
}

/**
 * Delete old spans for an organisation based on retention period.
 * Deletes spans where endTime (or startTime if endTime is missing) is older than the cutoff date.
 * @param organisationId - Organisation ID
 * @param retentionDays - Number of days to retain (spans older than this will be deleted)
 * @returns Number of deleted spans
 */
export async function deleteOldSpans(organisationId: string, retentionDays: number): Promise<number> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (retentionDays <= 0) {
    throw new Error('retentionDays must be greater than 0');
  }

  // Calculate cutoff time (milliseconds since epoch)
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  // Delete spans where:
  // - organisation matches
  // - (endTime < cutoffTime OR (endTime missing AND startTime < cutoffTime))
  // Use deleteByQuery for efficient bulk deletion
  const query = {
    bool: {
      must: [
        { term: { organisation: organisationId } }
      ],
      should: [
        // Spans with endTime older than cutoff
        { range: { endTime: { lt: cutoffTime } } },
        // Spans without endTime but with startTime older than cutoff
        {
          bool: {
            must_not: { exists: { field: 'endTime' } },
            must: { range: { startTime: { lt: cutoffTime } } }
          }
        }
      ],
      minimum_should_match: 1
    }
  };

  try {
    const response = await client.deleteByQuery({
      index: SPAN_INDEX_ALIAS,
      body: {
        query
      },
      refresh: true,
      conflicts: 'proceed' // Continue even if some documents are updated during deletion
    });

    return response.deleted || 0;
  } catch (error: any) {
    console.error(`Error deleting old spans for organisation ${organisationId}:`, error.message);
    throw error;
  }
}

/**
 * Close Elasticsearch client. Call during graceful shutdown.
 */
export async function closeClient(): Promise<void> {
  if (client) {
    // Elasticsearch client doesn't have a close method, but we can reset it
    client = null;
  }
}

