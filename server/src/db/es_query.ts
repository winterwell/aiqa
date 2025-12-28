/**
 * Elasticsearch query building functions.
 * Converts SearchQuery objects to Elasticsearch query DSL.
 */

import { Client } from '@elastic/elasticsearch';
import SearchQuery from '../common/SearchQuery.js';

/**
 * Convert SearchQuery to Elasticsearch query
 */
export function searchQueryToEsQuery(sq: SearchQuery | string | null | undefined): any {
  if (!sq) {
    return { match_all: {} };
  }

  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;
  if (!searchQuery.tree || searchQuery.tree.length === 0) {
    return { match_all: {} };
  }

  return buildEsQuery(searchQuery.tree);
}

/**
 * Process a single bit/item into an Elasticsearch query
 */
function buildEsQuery_oneBit(bit: any): any {
  if (typeof bit === 'string') {
    // Use query_string instead of deprecated _all field (removed in ES 6.0+)
    return { query_string: { query: bit, default_operator: 'AND' } };
  }
  if (typeof bit === 'object' && !Array.isArray(bit)) {
    const keys = Object.keys(bit);
    if (keys.length === 1) {
      const key = keys[0];
      let value = bit[key];
      // Handle unset (missing/null field)
      if (value === 'unset') {
        return { bool: { must_not: { exists: { field: key } } } };
      }
      // Convert string numbers to actual numbers for numeric fields
      if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (typeof value === 'string' && /^-?\d*\.\d+$/.test(value)) {
        value = parseFloat(value);
      }
      return { term: { [key]: value } };
    }
  }
  return buildEsQuery(Array.isArray(bit) ? bit : [bit]);
}

/**
 * Build Elasticsearch query from parse tree
 */
export function buildEsQuery(tree: any[]): any {
  if (typeof tree === 'string') {
    // Use query_string instead of deprecated _all field (removed in ES 6.0+)
    return { query_string: { query: tree, default_operator: 'AND' } };
  }

  if (tree.length === 1) {
    return buildEsQuery_oneBit(tree[0]);
  }

  const op = tree[0];
  const bits = tree.slice(1);
  const queries = bits.map((bit: any) => buildEsQuery_oneBit(bit));

  if (op === 'OR') {
    return { bool: { should: queries, minimum_should_match: 1 } };
  } else {
    return { bool: { must: queries } };
  }
}

/**
 * Build filter clauses from a filters object.
 */
function buildFilterClauses(filters?: Record<string, string>): any[] {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ term: { [key]: value } }));
}

/**
 * Get sort field based on index name (examples use 'created', spans use '@timestamp').
 */
function getSortField(indexName: string): string {
  return indexName.includes('examples') ? 'created' : '@timestamp';
}


/**
 * Extract total count from Elasticsearch response (handles both formats).
 */
function extractTotal(total: number | { value: number }): number {
  return typeof total === 'number' ? total : total.value;
}

/**
 * Generic search function for Elasticsearch
 * @param sourceFields - Array of field names to include in _source, or undefined for all fields.
 * @param _source_includes - Array of field names to include in _source, or undefined for all fields.
 * @param _source_excludes - Array of field names to exclude from _source, or undefined for no exclusions.
 */
export async function searchEntities<T>(
  client: Client,
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

  const baseQuery = searchQueryToEsQuery(searchQuery);
  const mustClauses: any[] = [];

  // Add the search query if it's not match_all
  if (!baseQuery.match_all) {
    mustClauses.push(baseQuery);
  }

  // Add filters
  mustClauses.push(...buildFilterClauses(filters));

  // If no must clauses, use match_all
  if (mustClauses.length === 0) {
    mustClauses.push({ match_all: {} });
  }

  // Build source filtering parameters for Elasticsearch
  // https://www.elastic.co/guide/en/elasticsearch/reference/current/search-fields.html#source-filtering
  // Handle unindexed_attributes automatically when attributes is included/excluded
  let sourceIncludes = _source_includes;
  let sourceExcludes = _source_excludes;
  
  if (sourceIncludes && sourceIncludes.length > 0) {
    // Specific fields requested - if attributes is requested, also include unindexed_attributes for merging
    if (sourceIncludes.includes('attributes') && !sourceIncludes.includes('unindexed_attributes')) {
      sourceIncludes = [...sourceIncludes, 'unindexed_attributes'];
    }
  }
  if (sourceExcludes && sourceExcludes.length > 0) {
    // If attributes is excluded, also exclude unindexed_attributes
    if (sourceExcludes.includes('attributes') && !sourceExcludes.includes('unindexed_attributes')) {
      sourceExcludes = [...sourceExcludes, 'unindexed_attributes'];
    }
  }

  // Build search request with source filtering
  const searchParams: any = {
    index: indexName,
    query: { bool: { must: mustClauses } },
    size: limit,
    from: offset,
    sort: [{ [getSortField(indexName)]: { order: 'desc' } }]
  };

  // Add source filtering if specified
  if (sourceIncludes && sourceIncludes.length > 0) {
    searchParams._source_includes = sourceIncludes;
  }
  if (sourceExcludes && sourceExcludes.length > 0) {
    searchParams._source_excludes = sourceExcludes;
  }

  const result = await client.search<T>(searchParams);

  let hits = (result.hits.hits || [])
    .map((hit: any) => hit._source!);
  // Merge unindexed_attributes with attributes at the same level (unindexed_attributes takes priority)
  hits = hits.map((hit: any) => {
    if (hit.unindexed_attributes) {
      const allAttributes = { ...(hit.attributes || {}), ...hit.unindexed_attributes };
      hit.attributes = allAttributes;
      delete hit.unindexed_attributes;
    }
    return hit;
  });
  // convert attributes.input, attributes.output from json string to object (if they are a json object)
  hits = hits.map((hit: any) => {
	if (isJsonString(hit.attributes?.input)) {
		try {
			hit.attributes.input = JSON.parse(hit.attributes.input);
		} catch (e) {
			console.warn(`Error parsing input for hit ${hit.id}: ${e}`);
		}
	}
	if (isJsonString(hit.attributes?.output)) {
		try {
			hit.attributes.output = JSON.parse(hit.attributes.output);
		} catch (e) {
			console.warn(`Error parsing output for hit ${hit.id}: ${e}`);
		}
	}
	return hit;
  });

  const total = extractTotal(result.hits.total as number | { value: number });

  return { hits, total };
}

/**
 * Quick but not foolproof check if a string is a JSON object or array.
 */
function isJsonString(str?: string): boolean {
  return str && typeof str === 'string' && (str[0] == '{' || str[0] == '[');
}