/**
 * Elasticsearch operations for storing and querying OpenTelemetry spans and examples.
 * 
 * Lifecycle: Call initClient() before any operations, closeClient() during shutdown.
 * All functions throw if client not initialized. Uses two indices: 'traces' for spans, 'DATASET_EXAMPLES' for examples.
 */

import { Client } from '@elastic/elasticsearch';
import Span from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { searchEntities as searchEntitiesEs } from './es_query.js';
import Example from '../common/types/Example.js';

let client: Client | null = null;
export const SPAN_INDEX = process.env.SPANS_INDEX || 'aiqa_spans';
export const SPAN_INDEX_ALIAS = process.env.SPANS_INDEX_ALIAS || 'aiqa_spans_alias';
export const DATASET_EXAMPLES_INDEX = process.env.DATASET_EXAMPLES_INDEX || 'aiqa_dataset_examples';
export const DATASET_EXAMPLES_INDEX_ALIAS = process.env.DATASET_EXAMPLES_INDEX_ALIAS || 'aiqa_dataset_examples_alias';

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

export { createIndices, generateSpanMappings } from './db_es_init.js';

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

/** Keys that must be stored as objects in ES flattened attributes to avoid mapping conflicts (e.g. Go sends string, Python sends object). */
const ATTRIBUTE_OBJECT_KEYS = ['input', 'output'];

/** Key used to wrap primitive input/output for ES flattened; distinctive to avoid clashing with user data. */
const AIQA_VALUE_KEY = 'aiqa_value';

/**
 * If v is a string that is valid JSON and parses to a plain object, return that object.
 * Otherwise return undefined (caller will wrap in { aiqa_value: v }).
 * This avoids storing filter_input/filter_output output as a wrapper when the client sent a JSON-serialized dict.
 */
function tryParseJsonObject(v: string): any {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  try {
    const parsed = JSON.parse(v);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Normalize attribute.input, .output to always be objects for ES: wrap primitives in { aiqa_value } so the index always sees an object.
 * String values that are valid JSON objects are parsed and stored as objects. On read, recognise and unwrap aiqa_value (or legacy value).
 */
function normalizeAttributesForFlattened(attributes: any): any {
  if (!attributes || typeof attributes !== 'object') return attributes;
  const out = { ...attributes };
  for (const key of ATTRIBUTE_OBJECT_KEYS) {
    if (out[key] === undefined || out[key] === null) continue;
    const v = out[key];
    if (typeof v === 'string') {
      const asObject = tryParseJsonObject(v);
      out[key] = asObject !== undefined ? asObject : { [AIQA_VALUE_KEY]: v };
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = { [AIQA_VALUE_KEY]: v };
    }
    // Arrays and objects left as-is so nested input/output still work
  }
  return out;
}

/**
 * If obj is a single-key wrapper { aiqa_value: x } or legacy { value: x }, return the inner value; otherwise return obj.
 * Used when returning spans so API/UI see unwrapped input/output.
 */
function unwrapAttributeWrapper(obj: any): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return obj;
  const v = obj[AIQA_VALUE_KEY] ?? obj.value;
  return v !== undefined ? v : obj;
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

// Transform span document for Elasticsearch
function transformSpanForEs(doc: any): any {
  const transformed = { ...doc };
  const unindexedBigAttributes: any = {};
  
  // Process top-level attributes
  const { truncated: attrsTruncated, bigAttributes: attrsBig } = processAttributes(transformed.attributes);
  // Normalize input/output so ES flattened always sees objects (avoids document_parsing_exception when clients send string)
  transformed.attributes = normalizeAttributesForFlattened(attrsTruncated);
  if (hasKeys(attrsBig)) {
    unindexedBigAttributes.attributes = attrsBig;
  }
  
  // Process events array
  const { transformed: eventsTransformed, bigAttributes: eventsBig } = processArrayWithAttributes(
    transformed.events,
    (event: any) => {
      const eventTransformed = { ...event };
      // Convert event.time to timestamp (time is already in milliseconds)
      if (eventTransformed.time !== undefined) {
        eventTransformed.timestamp = eventTransformed.time;
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
} //  end transformSpanForEs

// Transform example document for Elasticsearch
function transformExampleForEs(doc: any): any {
  const transformed = { ...doc };
  
  // Transform spans array if present
  if (Array.isArray(transformed.spans)) {
    transformed.spans = transformed.spans.map((span: any) => transformSpanForEs(span));
  }
  
  // Normalize input field: Elasticsearch flattened type expects an object, so wrap strings
  // Only wrap if it's a primitive (string, number, boolean) - objects are already fine
  if (transformed.input !== undefined && transformed.input !== null) {
    if (typeof transformed.input === 'string' || typeof transformed.input === 'number' || typeof transformed.input === 'boolean') {
      transformed.input = { value: transformed.input };
    }
    // If it's already an object or array, leave it as-is
  }
  


  return transformed;
} //  end transformExampleForEs

/** Generic bulk insert function. Returns the IDs of the documents that were inserted. */
async function bulkInsert<T>(indexName: string, documents: T[], transformFn?: (doc: any) => any): Promise<{ id: string }[]> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (documents.length === 0) return [];

  const transform = transformFn || transformSpanForEs;

  const body = documents.flatMap(doc => {
    const transformed = transform(doc);
    const docId = (doc as any).id;
    const indexAction = docId 
      ? { index: { _index: indexName, _id: docId } }
      : { index: { _index: indexName } };
    return [indexAction, transformed];
  });

  // refresh: true = immediate visibility (good for tests, avoid in production); wait_for = visible within ~1s
  const refresh = process.env.REFRESH_AFTER_INDEX === 'true' ? true : 'wait_for';
  const response = await client.bulk({
    body,
    refresh,
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
  return response.items.map((action: any) => ({ id: action.index._id }));
}

function isNotFoundError(error: any): boolean {
  return error.meta?.statusCode === 404;
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
 * Bulk insert spans into 'traces' index. Spans should have organisation set.
 */
export async function bulkInsertSpans(spans: Span[]): Promise<{id: string}[]> {
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

    // Transform the update document if needed (for fields like start, end)
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
export async function bulkInsertExamples(examples: Example[]): Promise<{ id: string }[]> {
  return bulkInsert<Example>(DATASET_EXAMPLES_INDEX_ALIAS, examples, transformExampleForEs);
}

/**
 * Get a document by ID from an Elasticsearch index using get-by-ID (not search).
 * Verifies organisation if organisationId is provided (doc.organisation must match).
 * @param index - Index alias (e.g. SPAN_INDEX_ALIAS, DATASET_EXAMPLES_INDEX_ALIAS)
 * @param id - Document ID (used as _id in Elasticsearch)
 * @param organisationId - Optional organisation ID; if provided, document must match or null is returned
 * @returns Document _source or null if not found or organisation mismatch
 */
export async function getItem(index: string, id: string, organisationId?: string): Promise<any | null> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }
  try {
    const getResponse = await client.get({ index, id });
    const doc = getResponse._source as any;
    if (organisationId != null && doc.organisation !== organisationId) {
      return null;
    }
    return doc;
  } catch (error: any) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Get a single example by ID. Uses getItem; unwraps input.value for backward compatibility.
 */
export async function getExample(id: string, organisationId?: string): Promise<Example | null> {
  const doc = await getItem(DATASET_EXAMPLES_INDEX_ALIAS, id, organisationId);
  if (!doc) return null;
  if (doc.input && typeof doc.input === 'object' && !Array.isArray(doc.input) && doc.input.value !== undefined && Object.keys(doc.input).length === 1) {
    doc.input = doc.input.value;
  }
  return doc as Example;
}

/**
 * Get a single span by ID. Uses getItem. Unwraps input/output from { aiqa_value } or legacy { value } so API returns raw values.
 */
export async function getSpan(id: string, organisationId?: string): Promise<Span | null> {
  const doc = await getItem(SPAN_INDEX_ALIAS, id, organisationId);
  if (doc?.attributes) {
    if (doc.attributes.input !== undefined) doc.attributes.input = unwrapAttributeWrapper(doc.attributes.input);
    if (doc.attributes.output !== undefined) doc.attributes.output = unwrapAttributeWrapper(doc.attributes.output);
  }
  return doc != null ? (doc as Span) : null;
}


/**
 * Update an example by ID in ElasticSearch. Performs partial update (only updates provided fields).
 * @param exampleId - The ID of the example to update (used as document _id in ElasticSearch)
 * @param updates - Partial example object with fields to update
 * @param organisationId - Optional organisation ID to verify ownership
 * @returns The updated example, or null if not found
 */
export async function updateExample(
  exampleId: string,
  updates: Partial<Example>,
  organisationId?: string
): Promise<Example | null> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  try {
    // Get the current document to verify it exists and belongs to the organisation
    const getResponse = await client.get({
      index: DATASET_EXAMPLES_INDEX_ALIAS,
      id: exampleId,
    });

    const currentExample = getResponse._source as any;
    
    // Verify organisation if provided
    if (organisationId && currentExample.organisation !== organisationId) {
      return null; // Example doesn't belong to this organisation
    }

    // Prepare update document - only include fields that are being updated
    const updateDoc: any = {};
    Object.keys(updates).forEach(key => {
      if (updates[key as keyof Example] !== undefined) {
        updateDoc[key] = updates[key as keyof Example];
      }
    });

    if (Object.keys(updateDoc).length === 0) {
      // No updates to apply, return current example
      return currentExample as Example;
    }

    // Normalize input field if being updated: Elasticsearch flattened type expects an object
    if (updateDoc.input !== undefined && updateDoc.input !== null) {
      if (typeof updateDoc.input === 'string' || typeof updateDoc.input === 'number' || typeof updateDoc.input === 'boolean') {
        updateDoc.input = { value: updateDoc.input };
      }
    }

    // Add updated timestamp
    updateDoc.updated = new Date();

    // Update the document by its _id
    await client.update({
      index: DATASET_EXAMPLES_INDEX_ALIAS,
      id: exampleId,
      body: {
        doc: updateDoc,
      },
      refresh: 'wait_for', // Make update immediately visible
    });

    // Fetch and return the updated document
    const updatedResponse = await client.get({
      index: DATASET_EXAMPLES_INDEX_ALIAS,
      id: exampleId,
    });

    const updatedExample = updatedResponse._source as any;
    
    // Unwrap input.value structure if it exists (for backward compatibility with string inputs)
    if (updatedExample.input && typeof updatedExample.input === 'object' && !Array.isArray(updatedExample.input) && updatedExample.input.value !== undefined && Object.keys(updatedExample.input).length === 1) {
      updatedExample.input = updatedExample.input.value;
    }
    
    return updatedExample as Example;
  } catch (error: any) {
    if (error.statusCode === 404) {
      return null; // Example not found
    }
    throw error;
  }
}

/**
 * Delete an example by ID from Elasticsearch.
 * @param exampleId - The ID of the example to delete (used as document _id in ElasticSearch)
 * @param organisationId - Optional organisation ID to verify ownership
 * @returns true if deleted, false if not found
 */
export async function deleteExample(
  exampleId: string,
  organisationId?: string
): Promise<boolean> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  try {
    // Get the current document to verify it exists and belongs to the organisation
    const getResponse = await client.get({
      index: DATASET_EXAMPLES_INDEX_ALIAS,
      id: exampleId,
    });

    const currentExample = getResponse._source as any;
    
    // Verify organisation if provided
    if (organisationId && currentExample.organisation !== organisationId) {
      return false; // Example doesn't belong to this organisation
    }

    // Delete the document by its _id
    await client.delete({
      index: DATASET_EXAMPLES_INDEX_ALIAS,
      id: exampleId,
      refresh: 'wait_for', // Make deletion immediately visible
    });

    return true;
  } catch (error: any) {
    if (error.statusCode === 404) {
      return false; // Example not found
    }
    throw error;
  }
}

/**
 * Delete spans by IDs or by trace IDs.
 * @param options - Either { span: string[] } or { traces: string[] }
 * @param organisationId - Organisation ID to verify ownership
 * @returns Number of deleted spans
 */
export async function deleteSpans(
  options: { spans: string[] } | { traces: string[] },
  organisationId: string
): Promise<number> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (!organisationId) {
    throw new Error('organisationId is required for deleteSpans');
  }
  const spanIds = (options as any).spans;
  const traceIds = (options as any).traces;

  try {
    if (spanIds) {
      // Delete by span IDs using bulk delete
      if (spanIds.length === 0) {
        return 0;
      }

      // Verify ownership before deleting
      const verifiedSpanIds: string[] = [];
      for (const spanId of spanIds) {
        try {
          const getResponse = await client.get({
            index: SPAN_INDEX_ALIAS,
            id: spanId,
          });
          const span = getResponse._source as any;
          if (span.organisation === organisationId) {
            verifiedSpanIds.push(spanId);
          }
        } catch (error: any) {
          if (error.statusCode !== 404) {
            throw error;
          }
          // Span not found - skip
        }
      }

      if (verifiedSpanIds.length === 0) {
        return 0;
      }

      // Delete only verified spans
      const body = verifiedSpanIds.flatMap(spanId => [
        { delete: { _index: SPAN_INDEX_ALIAS, _id: spanId } }
      ]);

      const response = await client.bulk({
        body,
        refresh: 'wait_for',
      });

      // Count successful deletions
      let successCount = 0;
      for (const item of response.items) {
        const deleteResult = item.delete;
        if (deleteResult?.status === 200 || deleteResult?.status === 201) {
          successCount++;
        }
      }

      return successCount;
    } else {
      // Delete by trace IDs using deleteByQuery
      if (traceIds.length === 0) {
        return 0;
      }
      // Note: organisation and trace are both keyword fields, so terms is the correct query type
      const query = {
        bool: {
          must: [
            { term: { organisation: organisationId } },
            { terms: { trace: traceIds } }
          ]
        }
      };

      const response = await client.deleteByQuery({
        index: SPAN_INDEX_ALIAS,
        body: {
          query
        },
        refresh: true,
        conflicts: 'proceed'
      });

      return response.deleted || 0;
    }
  } catch (error: any) {
    console.error(`Error deleting spans:`, error.message);
    throw error;
  }
}

/**
 * Quick but not foolproof check if a string is a JSON object or array.
 */
function isJsonString(str?: string): boolean {
  return str && typeof str === 'string' && (str[0] == '{' || str[0] == '[');
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
  const result = await searchEntities<Example>(
    DATASET_EXAMPLES_INDEX_ALIAS,
    searchQuery,
    hasKeys(filters) ? filters : undefined,
    limit,
    offset
  );
  
  // Unwrap input.value structure if it exists (for backward compatibility with string inputs)
  result.hits = result.hits.map((example: any) => {
    if (example.input && typeof example.input === 'object' && !Array.isArray(example.input) && example.input.value !== undefined && Object.keys(example.input).length === 1) {
      example.input = example.input.value;
    }
    return example;
  });
  
  return result;
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
 * Deletes spans where end (or start if end is missing) is older than the cutoff date.
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
  // - (end < cutoffTime OR (end missing AND start < cutoffTime))
  // Use deleteByQuery for efficient bulk deletion
  const query = {
    bool: {
      must: [
        { term: { organisation: organisationId } }
      ],
      should: [
        // Spans with end older than cutoff
        { range: { end: { lt: cutoffTime } } },
        // Spans without end but with start older than cutoff
        {
          bool: {
            must_not: { exists: { field: 'end' } },
            must: { range: { start: { lt: cutoffTime } } }
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
 * Releases the connection pool so the process can exit (avoids tap/timeout in tests).
 */
export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

